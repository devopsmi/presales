/**
 * FileParser SubAgent — reads raw files from session cache, parses them,
 * and writes back structured summaries via write_parsed tool.
 *
 * Does NOT generate the final requirement brief — that's the main agent's job.
 */
import { createAgent, tool } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import type { StoredFile } from "@/lib/agent/state";
import { parsePdf, parseWord, parseExcel } from "@/lib/agent/tools/file-parser";
import { createModelLoggingMiddleware } from "@/lib/agent/llm";
import log from "@/lib/logger";

const logger = log.child({ agent: "file_parser" });

const SYSTEM_PROMPT = `你是一位文件解析专家。请按顺序处理每个待解析的文件。

## 工作流程
1. 使用 read_file 工具按索引依次读取每个文件
2. 对每个文件，提取关键信息（功能点、技术栈、数据模型、业务规则等），用 write_parsed 工具保存解析摘要
3. 全部文件解析完成后输出 "解析完成：共 N 个文件"`;

async function parseByType(buffer: Buffer, name: string, type: string): Promise<string> {
  switch (type) {
    case "pdf": return parsePdf(buffer, name);
    case "word": return parseWord(buffer, name);
    case "excel": return parseExcel(buffer, name);
    default: return `[不支持的文件类型: ${type}]`;
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
        return `文件: ${file.name} (${file.type})\n\n${content}`;
      } catch (err) {
        return `文件: ${file.name} 解析失败: ${String(err)}`;
      }
    },
    {
      name: "read_file",
      description: `读取并解析文件原始内容。可用文件: ${fileList}。参数为文件索引号。`,
      schema: z.object({ index: z.number().describe("文件索引号") }),
    },
  );
}

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
      description: "将文件的关键信息摘要写入缓存。包含功能点、技术栈、业务规则等。每个文件解析完成后必须调用。",
      schema: z.object({
        index: z.number().describe("文件索引号"),
        summary: z.string().describe("文件的关键信息摘要"),
      }),
    },
  );
}

export async function runFileParser(
  model: BaseChatModel,
  fileStore: Map<number, StoredFile>,
): Promise<{ parsedCount: number }> {
  const files = Array.from(fileStore.values());
  const unparsedCount = files.filter((f) => !f.parsed).length;
  logger.info("file_parser start", { totalFiles: files.length, unparsed: unparsedCount });

  const tools = [
    buildReadFileTool(files),
    buildWriteParsedTool(files),
  ] as Parameters<typeof createAgent>[0]["tools"];

  const agent = createAgent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    tools,
    middleware: [createModelLoggingMiddleware("file_parser")],
  });

  const userPrompt = `请按顺序处理以下文件，每个文件先 read_file 再 write_parsed：\n${files.filter((f) => !f.parsed).map((f) => `- [${f.index}] ${f.name} (${f.type})`).join("\n")}`;

  await agent.invoke({ messages: [{ role: "user", content: userPrompt }] });

  const parsedCount = Array.from(fileStore.values()).filter((f) => f.parsed).length;
  logger.info("file_parser complete", { parsedCount });
  return { parsedCount };
}
