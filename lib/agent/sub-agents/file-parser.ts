/**
 * FileParser SubAgent — reads raw files from session cache, parses them,
 * and writes back structured summaries via write_parsed tool.
 *
 * Does NOT generate the final requirement brief — that's the main agent's job.
 *
 * Design principles (from XLSX/DOCX/PDF domain skills):
 *  - Each file type gets a format-specific instruction header injected into the
 *    read_file output so the LLM interprets semantics correctly.
 *  - The system prompt embeds domain rules: document hierarchy as decomposition
 *    tree, formula+color as business logic signals, table detection heuristics.
 */
import { createAgent, tool } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import type { StoredFile } from "@/lib/agent/state";
import { parsePdf, parseWord, parseExcel, lookAtImage } from "@/lib/agent/tools/file-parser";
import { createModelLoggingMiddleware } from "@/lib/agent/llm";
import { getSessionConfig } from "@/lib/session-config";
import { resolvePrompt } from "@/lib/prompt-defaults";
import log from "@/lib/logger";

const logger = log.child({ agent: "file_parser" });

// ---------------------------------------------------------------------------
// File-type dispatch
// ---------------------------------------------------------------------------

async function parseByType(buffer: Buffer, name: string, type: string): Promise<string> {
  switch (type) {
    case "pdf": return parsePdf(buffer, name);
    case "word": return parseWord(buffer, name);
    case "excel": return parseExcel(buffer, name);
    case "image": return lookAtImage(buffer, name);
    default: return `[不支持的文件类型: ${type}]`;
  }
}

// ---------------------------------------------------------------------------
// Tool: read_file — reads & parses raw content from file store
// ---------------------------------------------------------------------------

/** Format-specific metadata header injected before raw content. */
function formatReadFileHeader(file: StoredFile): string {
  const base = `📄 文件: ${file.name}\n📎 类型: ${file.type}`;
  switch (file.type) {
    case "word":
      return [
        base,
        "📐 解析方式: mammoth HTML — 标题/列表/粗斜体层级已保留",
        "   👆 请参考系统提示词中「Word 文档专属规则」理解文档结构",
        "",
      ].join("\n");
    case "excel":
      return [
        base,
        "📊 解析方式: exceljs 双通道 — 显示计算值，公式以 (==FORMULA) 标注",
        "   👆 请参考系统提示词中「Excel 文档专属规则」理解格式语义",
        "",
      ].join("\n");
    case "pdf":
      return [
        base,
        "📑 解析方式: pdf-parse 纯文本 — 请主动检测章节模式与表格数据",
        "   👆 请参考系统提示词中「PDF 文档专属规则」理解文档结构",
        "",
      ].join("\n");
    case "image":
      return [
        base,
        "📷 解析方式: sharp 元数据提取 — 仅获取格式/尺寸，不含内容文本",
        "   ⚠️ 图片内容需视觉模型分析，当前仅记录元数据",
        "",
      ].join("\n");
  }
}

function buildReadFileTool(files: StoredFile[]) {
  const fileList = files.map((f) => `[${f.index}] ${f.name}`).join(" ");
  return tool(
    async ({ index }: { index: number }): Promise<string> => {
      const file = files.find((f) => f.index === index);
      if (!file) return `错误：文件索引 ${index} 不存在`;
      if (file.parsed) return `[已解析] 文件: ${file.name}\n解析摘要:\n${file.parsed}`;
      const buffer = Buffer.from(file.body, "base64");
      try {
        const content = await parseByType(buffer, file.name, file.type);
        const header = formatReadFileHeader(file);
        return header + content;
      } catch (err) {
        return `文件: ${file.name} 解析失败: ${String(err)}`;
      }
    },
    {
      name: "read_file",
      description: `读取并解析文件原始内容。可用文件: ${fileList}。参数为文件索引号。读取后请根据文件类型专属规则提取结构化摘要。`,
      schema: z.object({ index: z.number().describe("文件索引号") }),
    },
  );
}

// ---------------------------------------------------------------------------
// Tool: write_parsed — writes LLM-extracted summary back to StoredFile
// ---------------------------------------------------------------------------

function buildWriteParsedTool(files: StoredFile[]) {
  return tool(
    async ({ index, summary }: { index: number; summary: string }): Promise<string> => {
      const file = files.find((f) => f.index === index);
      if (!file) return `错误：文件索引 ${index} 不存在`;
      file.parsed = summary;
      return `文件 "${file.name}" 解析摘要已保存 (${summary.length} 字符)`;
    },
    {
      name: "write_parsed",
      description:
        "将文件的结构化摘要写入缓存。摘要必须为 Markdown 格式，包含：## 文件类型、## 关键功能点、## 技术栈、## 数据模型、## ⚠️ 质量标记。每个文件解析完成后必须调用。",
      schema: z.object({
        index: z.number().describe("文件索引号"),
        summary: z.string().describe("文件的结构化摘要（Markdown 格式）"),
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runFileParser(
  model: BaseChatModel,
  sessionId: string,
  fileStore: Map<number, StoredFile>,
): Promise<{ parsedCount: number }> {
  const files = Array.from(fileStore.values());
  const unparsedCount = files.filter((f) => !f.parsed).length;
  logger.info("file_parser start", { totalFiles: files.length, unparsed: unparsedCount });

  const overrides = getSessionConfig(sessionId)?.promptOverrides;
  const effectiveSystemPrompt = resolvePrompt("file_parser", overrides);

  const tools = [
    buildReadFileTool(files),
    buildWriteParsedTool(files),
  ] as Parameters<typeof createAgent>[0]["tools"];

  const agent = createAgent({
    model,
    systemPrompt: effectiveSystemPrompt,
    tools,
    middleware: [createModelLoggingMiddleware("file_parser")],
  });

  const userPrompt = `请按顺序处理以下文件，每个文件先 read_file 再 write_parsed：\n${files.filter((f) => !f.parsed).map((f) => `- [${f.index}] ${f.name} (${f.type})`).join("\n")}`;

  await agent.invoke({ messages: [new HumanMessage(userPrompt)] });

  const parsedCount = Array.from(fileStore.values()).filter((f) => f.parsed).length;
  logger.info("file_parser complete", { parsedCount });
  return { parsedCount };
}
