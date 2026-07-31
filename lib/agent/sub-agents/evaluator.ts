/**
 * Evaluator SubAgent — after decomposer completes, reviews the decomposition
 * against the original structuredBrief for fidelity.
 *
 * Uses a tool-calling agent pattern:
 *  - The evaluator is given a read_rows tool bound to the decomposer's output,
 *    allowing it to read quotation rows incrementally (by module, sub_module)
 *    rather than receiving the entire quotation in one giant prompt.
 *  - The structuredBrief is provided directly in the user prompt.
 *
 * Fails when the requirements are detailed and the decomposition exhibits:
 *   - Omission: requirement items absent from the decomposition
 *   - Duplication: same functionality appearing under different names
 *   - Fabrication: decomposition items not present in the original brief
 *   - Inconsistency: decomposition items contradicting the brief
 */
import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { EvaluatorOutput } from "@/lib/agent/state";
import type { QuotationRow } from "@/lib/types";
import { createModelLoggingMiddleware, extractStringContent } from "@/lib/agent/llm";
import { getSessionConfig } from "@/lib/session-config";
import { resolvePrompt } from "@/lib/prompt-defaults";
import { buildReadRowsTool } from "@/lib/agent/tools/read-rows";
import log from "@/lib/logger";

const logger = log.child({ agent: "evaluator" });

/** Parse the LLM's JSON output into a strongly-typed EvaluatorOutput. */
function parseEvaluatorOutput(raw: unknown): EvaluatorOutput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "Evaluator: expected JSON object, got " + (raw === null ? "null" : typeof raw),
    );
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.passed !== "boolean") {
    throw new Error("Evaluator: missing or invalid 'passed' field (must be boolean)");
  }

  const issues: EvaluatorOutput["issues"] = [];
  if (Array.isArray(obj.issues)) {
    for (const item of obj.issues as Array<Record<string, unknown>>) {
      if (typeof item.severity !== "string" || !["error", "warning"].includes(item.severity)) {
        logger.warn("evaluator: skipping issue with invalid severity", { item });
        continue;
      }
      if (typeof item.location !== "string" || !item.location.trim()) {
        logger.warn("evaluator: skipping issue with invalid location", { item });
        continue;
      }
      if (typeof item.description !== "string" || !item.description.trim()) {
        logger.warn("evaluator: skipping issue with invalid description", { item });
        continue;
      }
      issues.push({
        severity: item.severity as "error" | "warning",
        location: item.location,
        description: item.description,
      });
    }
  }

  return {
    passed: obj.passed,
    issues,
    summary: typeof obj.summary === "string" ? obj.summary : "",
  };
}

/**
 * Extract and parse the final JSON evaluation result from the agent's last message.
 * The agent may have made multiple tool calls before producing the final answer.
 */
function extractEvaluationFromMessages(messages: unknown): { output: string; parsed: EvaluatorOutput } {
  // messages is typically an array of LangChain message objects
  const msgArray = Array.isArray(messages) ? messages : [];
  if (msgArray.length === 0) {
    throw new Error("Evaluator: no messages returned from agent");
  }

  // Get the last (AIMessage) content — this is the final evaluation JSON
  const lastMessage = msgArray[msgArray.length - 1];
  const rawContent = lastMessage?.content;
  const output = extractStringContent(rawContent);

  if (!output) {
    throw new Error("Evaluator: empty output from agent");
  }

  // Match JSON object — prioritize object over array
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Evaluator: no JSON object found in agent output");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    throw new Error(`Evaluator: failed to parse JSON — ${String(err)}`);
  }

  return { output, parsed: parseEvaluatorOutput(parsed) };
}

/** Build the user prompt — only contains the structuredBrief; quotation is accessed via read_rows tool. */
function buildUserPrompt(structuredBrief: string, totalRows: number): string {
  return [
    "## 原始需求简报",
    structuredBrief,
    "",
    "---",
    "",
    `## 报价功能清单（共 ${totalRows} 行）`,
    `报价功能清单已通过 \`read_rows\` 工具绑定，你可以分批次、分模块读取和比对。`,
    "",
    "### 建议阅读策略",
    `1. 先调用 \`read_rows({})\` (不传参) 获取全部行的层级概览（不含功能描述），了解清单的结构和规模`,
    `2. 按模块名逐批深度检查：\`read_rows({ module: "XX" })\` 读取一个模块的所有行（含完整描述）`,
    `3. 如有疑似重复或遗漏，用 \`read_rows({ seqs: [3, 8, 15] })\` 精确定位对比`,
    `4. 确认遗漏时，想好在需求的哪个位置新增，在 issue 的 location 中描述`,
    "",
    "请逐一核对报价表的每个功能项是否与原始需求简报一致。评估完成后，在最终回复中输出完整的评估结果 JSON 对象。",
  ].join("\n");
}

export async function runEvaluator(
  model: BaseChatModel,
  sessionId: string,
  input: {
    rows: QuotationRow[];
    structuredBrief: string;
  },
): Promise<EvaluatorOutput> {
  logger.info("evaluator start", {
    sessionId,
    rowCount: input.rows.length,
    briefLen: input.structuredBrief.length,
  });

  if (!input.rows.length || !input.structuredBrief) {
    return {
      passed: false,
      issues: [
        {
          severity: "error",
          location: "输入",
          description: "报价数据或需求简报为空，无法评估。",
        },
      ],
      summary: "输入数据不完整",
    };
  }

  const overrides = getSessionConfig(sessionId)?.promptOverrides;
  const systemPrompt = resolvePrompt("evaluator", overrides);
  const userPrompt = buildUserPrompt(input.structuredBrief, input.rows.length);

  // Build the read_rows tool bound to the decomposer's output rows
  const readRowsTool = buildReadRowsTool(input.rows);

  const agent = createAgent({
    model,
    tools: [readRowsTool],
    systemPrompt,
    middleware: [createModelLoggingMiddleware("evaluator")],
  });

  const result = await agent.invoke({
    messages: [new HumanMessage(userPrompt)],
  });

  const evalResult = extractEvaluationFromMessages(result.messages);

  logger.info("evaluator complete", {
    passed: evalResult.parsed.passed,
    issueCount: evalResult.parsed.issues.length,
  });

  return evalResult.parsed;
}
