import type { PipelineState, PipelineEvent } from "@/lib/agent/state";

/**
 * Parser node: consumes raw text + attachments and produces a structured brief.
 *
 * Yields agent_start / agent_progress / agent_complete events,
 * and returns { structuredBrief, customerName, projectName }.
 */
export async function* runParserNode(
  state: PipelineState,
  runLlm: (params: {
    systemPrompt: string;
    userPrompt: string;
    agentName: string;
    state: PipelineState;
  }) => Promise<string>,
): AsyncGenerator<PipelineEvent, Partial<PipelineState>> {
  yield { type: "agent_start", agent: "parser" };

  const systemPrompt = buildParserSystemPrompt();
  const userPrompt = buildParserUserPrompt(state);

  yield { type: "agent_progress", agent: "parser", message: "正在解析需求文档，提取关键信息..." };

  const output = await runLlm({
    systemPrompt,
    userPrompt,
    agentName: "parser",
    state,
  });

  // Extract customer name and project name from output (deterministic mock produces markdown)
  const customerName = extractName(output, /客户名称[：:]\s*(.+)/) ?? "未指定客户";
  const projectName = extractName(output, /^##\s*(.+)/m) ?? "未指定项目";

  yield {
    type: "agent_complete",
    agent: "parser",
    output: { customerName, projectName },
  };

  return {
    structuredBrief: output,
    customerName,
    projectName,
  };
}

function buildParserSystemPrompt(): string {
  return `你是一位资深的售前需求分析师。请根据客户提供的原始需求文档或文字描述，整理出一份结构化的需求简报。

输出格式为 Markdown，需要包含以下内容：
1. 项目标题
2. 客户信息（客户名称、行业类型）
3. 项目概述
4. 核心模块列表
5. 技术要求
6. 交付要求

请确保输出专业、结构清晰、便于后续功能拆解。`;
}

function buildParserUserPrompt(state: PipelineState): string {
  const parts: string[] = [];

  if (state.rawText) {
    parts.push(`## 客户原始需求描述\n\n${state.rawText}`);
  }

  for (const att of state.attachments) {
    parts.push(`## 附件：${att.name}（${att.type}）\n\n${att.content}`);
  }

  if (parts.length === 0) {
    parts.push("（无输入内容，请根据经验生成一个示例需求简报）");
  }

  return parts.join("\n\n---\n\n");
}

function extractName(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match?.[1]?.trim() ?? null;
}
