/**
 * Decomposer SubAgent — uses LangChain createAgent to break structured brief
 * into a 5-level QuotationRow[] hierarchy.
 */
import { createAgent } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { QuotationRow } from "@/lib/types";
import type { DecomposerOutput } from "@/lib/agent/state";
import { createModelLoggingMiddleware } from "@/lib/agent/llm";
import log from "@/lib/logger";

const logger = log.child({ agent: "decomposer" });

const SYSTEM_PROMPT = `你是一位资深的功能拆解专家，负责将需求简报拆解为五级层次的功能清单。

## 五级层次
模块 → 子模块 → 功能 → 子功能 → 功能描述

## 输出格式
纯 JSON 数组，每个元素为一行功能项：
{
  "seq": 数字序号,
  "module": "一级模块名",
  "sub_module": "二级子模块名",
  "function": "三级功能名",
  "sub_function": "四级子功能名",
  "description": "功能详细描述（20-50字）",
  "category": "design" | "feature",
  "trades": {},
  "remark": ""
}

## 规则
- category 为 "design" 表示系统设计/架构类，"feature" 表示业务功能类
- 至少包含 2-4 行系统设计类（技术架构、数据设计、UI设计）
- 至少包含 6-10 行业务功能类
- 模块命名：系统设计、用户端、管理后台 等
- trades 和 remark 字段留空对象/空字符串
- 子功能与功能至少为不同的名称（更具体）
- 描述应包含功能内容和业务价值

## 示例
[
  {
    "seq": 1,
    "module": "系统设计",
    "sub_module": "技术架构",
    "function": "技术选型",
    "sub_function": "前后端技术栈选型",
    "description": "确定前端框架、后端语言、数据库等技术组件，设计整体系统架构",
    "category": "design",
    "trades": {},
    "remark": ""
  }
]`;

function detectCategory(module: string, subModule: string, func: string): "design" | "feature" {
  const designKeywords = ["系统设计", "架构", "数据", "UI", "设计", "技术选型", "数据库", "部署"];
  const combined = `${module}${subModule}${func}`;
  return designKeywords.some((k) => combined.includes(k)) ? "design" : "feature";
}

function parseRowsFromOutput(output: string): QuotationRow[] {
  const match = output.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("Decomposer: no JSON array found in output");

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("Decomposer: failed to parse JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Decomposer: expected JSON array");
  }

  return (parsed as Array<Record<string, unknown>>).map(
    (item, idx): QuotationRow => ({
      seq: typeof item.seq === "number" ? item.seq : idx + 1,
      module: typeof item.module === "string" ? item.module : "",
      sub_module: typeof item.sub_module === "string" ? item.sub_module : "",
      function: typeof item.function === "string" ? item.function : "",
      sub_function: typeof item.sub_function === "string" ? item.sub_function : "",
      description: typeof item.description === "string" ? item.description : "",
      category: item.category === "design" || item.category === "feature"
        ? item.category
        : detectCategory(
            String(item.module ?? ""),
            String(item.sub_module ?? ""),
            String(item.function ?? ""),
          ),
      trades: {},
      remark: "",
    }),
  );
}

export async function runDecomposer(
  model: BaseChatModel,
  input: { structuredBrief: string },
): Promise<DecomposerOutput> {
  logger.info("decomposer start");

  const agent = createAgent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    middleware: [createModelLoggingMiddleware("decomposer")],
  });

  const userPrompt = `请根据以下需求简报，生成功能拆解清单：\n\n${input.structuredBrief}`;
  const result = await agent.invoke({
    messages: [{ role: "user", content: userPrompt }],
  });

  const output = typeof result.messages?.at(-1)?.content === "string"
    ? result.messages.at(-1)!.content as string
    : "";

  const rows = parseRowsFromOutput(output);
  logger.info("decomposer complete", { rowCount: rows.length });
  return { rows };
}
