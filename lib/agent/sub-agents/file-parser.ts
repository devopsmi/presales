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
import log from "@/lib/logger";

const logger = log.child({ agent: "file_parser" });

// ---------------------------------------------------------------------------
// System prompt — domain rules from XLSX / DOCX / PDF skills
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是一位文件解析专家，精通 Word、Excel、PDF 三种格式的深层语义理解。
请按顺序处理每个待解析的文件，对每个文件调用 read_file 读取原始内容，然后用 write_parsed 保存结构化摘要。

## 通用工作流程
1. 使用 read_file 工具按索引依次读取每个文件
2. 对每个文件，提取关键信息并以 Markdown 结构写入 write_parsed 摘要：
   - ## 文件类型识别（需求文档？报价表？技术规格书？）
   - ## 关键功能点（用 "- " 列表）
   - ## 技术栈/工具链（如有提及）
   - ## 数据模型/实体定义（如有定义）
   - ## ⚠️ 数据质量标记（按下方各格式专属规则）
3. 全部文件解析完成后输出 "解析完成：共 N 个文件"

## Word 文档专属规则（来自 DOCX 领域专家）

1. **层级即需求树**：HTML 标题级次（h1/h2/h3）映射到功能拆解层次。
   - h1 = 业务域（如 "用户管理"）
   - h2 = 功能模块（如 "注册登录"）
   - h3 = 具体功能点（如 "手机号验证码登录"）
   - 用 ### 前缀标记文档内部章节，保持层级关系

2. **列表即需求项**：编号列表（<ol>）或项目符号（<ul>）中的每一项都应作为独立功能点考量

3. **粗体/斜体标记关键信息**：<strong> / <em> 标记的文本通常是技术约束或核心需求

4. **修订痕迹检测**：若文档中出现自相矛盾或重复描述（如 "使用MySQL" vs "使用PostgreSQL"），
   这很可能是未接受修订的残留内容。输出时标记为 ⚠️ 并注明两种方案，供人工确认。

## Excel 文档专属规则（来自 XLSX 领域专家）

1. **公式即逻辑**：不要只看数值，公式揭示了计算规则和业务逻辑。
   - "=SUM(B2:B10)" → 这是一个汇总行
   - "=B5*单价!$A$1" → 跨 Sheet 引用，去相关 Sheet 找基准单价
   - "==公式" 标记的单元格同时显示计算值和原始公式

2. **格式即语义**：
   - 🔵 蓝色字体 = 可调参数（这些是报价的"输入变量"，不是固定值）
   - 🟡 黄色填充 = 待确认项（这些需要用户补全，不能跳过）
   - 📊 百分比 / 💰 金额 / 🔢 倍数 → 列格式提示说明了该列的数据含义
   - 数字格式决定了值的语义：$#,##0 是金额，0.0% 是百分比

3. **空单元格不等于无意义**：检查同行/同列公式是否引用了它，可能是一个待填输入参数

4. **Sheet 间引用**：若公式包含跨表引用，意味着数据分布在多页，需要跨 Sheet 全局理解

## PDF 文档专属规则（来自 PDF 领域专家）

1. **扫描件检测**：若输出开头标注 "⚠️ 扫描件"，说明文本层为空或不完整，
   无法可靠解析。标记为 ⚠️ 并跳过该文件。

2. **表格识别**：若连续行中出现规律性空格、制表符或数字分隔，
   很可能是表格数据。尝试将其重构为 Markdown 表格格式理解。

3. **章节号模式**：匹配 "第X章"、"第X节"、数字编号（1. / 1.1 / 1.1.1）
   等模式，还原文档结构层级。

4. **页眉页脚过滤**：每页重复出现的相同内容（如 "XX公司 - 机密"）通常为页眉页脚，
   不是正文需求，请忽略。

5. **元数据优先**：PDF 元数据中的标题字段通常比文件名更准确描述文档内容。

## 输出格式规范
write_parsed 的 summary 字段使用 Markdown 结构：
- 用 ## 标记顶层分类（文件类型、功能点、技术栈、数据模型、质量标记）
- 用 ### 标记文档内部章节（保持 Word 标题映射的层级）
- 用 - 列表标记功能点
- 用 ⚠️ 前缀标记数据质量警告（扫描件、修订残留、矛盾描述、待填项）
- 保留原始关键数字/公式/参数值，不要模糊化`;

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

  await agent.invoke({ messages: [new HumanMessage(userPrompt)] });

  const parsedCount = Array.from(fileStore.values()).filter((f) => f.parsed).length;
  logger.info("file_parser complete", { parsedCount });
  return { parsedCount };
}
