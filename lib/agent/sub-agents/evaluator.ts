/**
 * Evaluator SubAgent — after decomposer completes, reviews the decomposition
 * against the original structuredBrief for fidelity.
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
import { createModelLoggingMiddleware, extractStringContent } from "@/lib/agent/llm";
import { getSessionConfig } from "@/lib/session-config";
import { resolvePrompt } from "@/lib/prompt-defaults";
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
        seq: typeof item.seq === "number" ? item.seq : undefined,
      });
    }
  }

  return {
    passed: obj.passed,
    issues,
    summary: typeof obj.summary === "string" ? obj.summary : "",
  };
}

/** Build the user prompt containing the full quotation + structuredBrief for evaluation. */
function buildUserPrompt(opts: {
  quotationJson: string;
  structuredBrief: string;
}): string {
  return [
    "## 原始需求简报",
    opts.structuredBrief,
    "",
    "---",
    "",
    "## 生成的报价表（完整 JSON）",
    opts.quotationJson,
    "",
    "请逐一核对报价表的每个功能项是否与原始需求简报一致。输出评估结果 JSON。",
  ].join("\n");
}

export async function runEvaluator(
  model: BaseChatModel,
  sessionId: string,
  input: {
    quotationJson: string;
    structuredBrief: string;
  },
): Promise<EvaluatorOutput> {
  logger.info("evaluator start", {
    sessionId,
    quotationLen: input.quotationJson.length,
    briefLen: input.structuredBrief.length,
  });

  if (!input.quotationJson || !input.structuredBrief) {
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
  const userPrompt = buildUserPrompt({
    quotationJson: input.quotationJson,
    structuredBrief: input.structuredBrief,
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    let prompt = userPrompt;
    if (attempt > 0) {
      prompt += "\n\n⚠️ 上一次输出校验失败，请修正后重新输出有效 JSON。";
    }

    const agent = createAgent({
      model,
      systemPrompt,
      middleware: [createModelLoggingMiddleware("evaluator")],
    });

    const result = await agent.invoke({
      messages: [new HumanMessage(prompt)],
    });

    const rawContent = result.messages?.at(-1)?.content;
    const output = extractStringContent(rawContent);

    if (!output) {
      const errMsg = `Evaluator: empty output on attempt ${attempt + 1}`;
      if (attempt === 0) { logger.warn(errMsg); continue; }
      throw new Error(errMsg);
    }

    // Match JSON object — prioritize object over array
    const match = output.match(/\{[\s\S]*\}/);
    if (!match) {
      const errMsg = "Evaluator: no JSON object found in output";
      if (attempt === 0) { logger.warn(errMsg); continue; }
      throw new Error(errMsg);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch (err) {
      if (attempt === 0) {
        logger.warn("evaluator: JSON parse failed, retrying", { error: String(err) });
        continue;
      }
      throw new Error(`Evaluator: failed to parse JSON — ${String(err)}`);
    }

    const evalResult = parseEvaluatorOutput(parsed);

    logger.info("evaluator complete", {
      passed: evalResult.passed,
      issueCount: evalResult.issues.length,
    });
    return evalResult;
  }

  throw new Error("Evaluator: unreachable");
}
