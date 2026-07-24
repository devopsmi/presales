/**
 * Decomposer SubAgent — BFS layer-by-layer decomposition.
 *
 * Breaks a structured brief into QuotationRow[] across 4 sequential LLM rounds:
 *   Round 1 (Module) → Round 2 (Sub-Module) → Round 3 (Function) → Round 4 (Leaf)
 *
 * Each round outputs compact {parent → children} mappings to minimize token waste.
 * Final stitch() reconstructs full QuotationRow[] from the forward-reference chain.
 */
import type { DecomposerProgress } from "@/lib/agent/state";
import { createAgent } from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import fs from "fs";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { QuotationRow } from "@/lib/types";
import type { DecomposerOutput } from "@/lib/agent/state";
import { createModelLoggingMiddleware, extractStringContent } from "@/lib/agent/llm";
import { getSessionConfig } from "@/lib/session-config";
import { resolvePrompt } from "@/lib/prompt-defaults";
import log from "@/lib/logger";

const logger = log.child({ agent: "decomposer" });

// ===========================================================================
// Low-level LLM invoke — returns parsed JSON (array or object)
// ===========================================================================

async function invokeAndExtractJson(
  model: BaseChatModel,
  agentName: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<unknown> {
  logger.info(`${agentName} start`);

  const agent = createAgent({
    model,
    systemPrompt,
    middleware: [createModelLoggingMiddleware(agentName)],
  });

  const result = await agent.invoke({
    messages: [new HumanMessage(userPrompt)],
  });

  const output = extractStringContent(result.messages?.at(-1)?.content);
  if (!output) {
    const blocks = Array.isArray(result.messages?.at(-1)?.content)
      ? (result.messages!.at(-1)!.content as Array<{ type: string }>).map((b) => b.type).join(", ")
      : typeof result.messages?.at(-1)?.content;
    throw new Error(`Decomposer ${agentName}: empty output (blocks: ${blocks})`);
  }

  // Match either JSON object or JSON array.
  // Object MUST come first: if output is an object containing nested arrays,
  // the greedy array regex would grab from the first '[' to the last ']',
  // producing invalid JSON. Object regex has no such ambiguity.
  const objectMatch = output.match(/\{[\s\S]*\}/);
  const arrayMatch = output.match(/\[[\s\S]*\]/);
  const match = objectMatch ?? arrayMatch;
  if (!match) {
    const head = output.slice(0, 200);
    const tail = output.slice(-200);
    throw new Error(
      `Decomposer ${agentName}: no JSON found (len=${output.length}, head="${head}", tail="${tail}")`,
    );
  }

  let parsed: unknown;
  try { parsed = JSON.parse(match[0]); } catch (err) {
    const dumpFile = `/tmp/decomposer_${agentName}_${Date.now()}_raw.txt`;
    fs.writeFileSync(dumpFile, output, "utf-8");
    throw new Error(
      `Decomposer ${agentName}: JSON parse failed — ${String(err)}. Full output dumped to ${dumpFile} (${output.length} chars)`,
    );
  }

  logger.info(`${agentName} complete`);
  return parsed;
}

// ===========================================================================
// Layer prompts — each focuses the LLM on a SINGLE hierarchy level
// ===========================================================================

const R1_MODULE_PROMPT = `你是资深系统架构师。根据项目需求简报，识别所有一级模块。

## 拆解维度（必须先锁定）
全程以业务价值维度为主线：模块和子模块按业务域划分，技术实现下沉到子功能描述中，不占用拆解层级。

## 模块的定义
模块是一级业务域，是最高层级的独立闭环单元。每个模块对应一个完整的业务目标，具备以下特征：
- 可独立对外提供服务，模块间低耦合，通过接口/流程交互
- 对应独立的业务负责人/研发团队，可独立迭代、独立上线
- 模块内业务高度内聚，和其他模块边界清晰

## 粒度控制标准
### 合格信号
- 用一句话可清晰描述该模块职责，不出现"和""以及"等并列词
- 模块数量通常在 3-8 个

### 过粗信号（需要拆分）
- 一个模块覆盖多个不相关的业务域（如"商品+订单+用户"合并为一个模块）

### 过细信号（需要合并）
- 把单个功能定义为模块

## 输出格式
纯 JSON 字符串数组：
["模块名", "模块名", ...]

## 规则
- 必须包含"系统设计"模块
- 模块命名简洁明了（如"用户中心"、"管理后台"、"数据大屏"）
- 模块数量根据项目规模确定，通常 3-8 个
- 只输出 JSON 数组，不要其他内容`;

const R2_SUB_MODULE_PROMPT = `你是功能分析师。根据项目简报和已确定的模块，为每个模块拆解子模块。

## 拆解逻辑：向上聚合
子模块不是从模块"拆分"出来的，而是将功能向上聚合而成的容器。在模块内部，把业务高度相关的功能归为一个子模块。每个子模块是同方向功能的集合，对应小组级的责任边界。

## 子模块的定义与粒度标准
### 是什么
子模块是用户在产品中导航到的独立区域——一个页面、一个面板、一个入口。它们是"去哪里"，不是"做什么"。

### 粒度合格标准
- 只负责模块内单一业务方向，职责不跨领域
- 用一句话可清晰描述职责（不含"和""以及"）
- 每个模块拆 2-5 个子模块

### 过粗信号（需要拆分）
- 一个模块只拆出 1-2 个子模块，或子模块间业务重叠度高

### 过细信号（需要合并）
- 把单个功能点（如"密码找回"）定义为子模块

---

**业务模块的子模块**：独立页面或功能区域。用户能从导航直接到达 → 是子模块；用户在同一页面内完成的若干操作 → 不是子模块，是功能（留给下一层）。

好的拆分（模块"管理后台"）：
  "仪表盘"、"用户管理"、"内容管理"、"系统设置"、"操作日志"

**设计模块的子模块**：技术架构相关的独立关注面。

好的拆分（模块"系统设计"）：
  "技术架构设计"、"数据模型设计"、"UI设计体系"、"部署与运维方案"

## 输出格式（紧凑映射）
纯 JSON 对象，key 为模块名，value 为该模块的子模块数组：
{"模块A": ["子模块1", "子模块2"], "模块B": ["子模块3"]}

## 规则
- 每个模块拆 2-5 个子模块，复杂项目可适当增加但不超过 7 个
- 输入有 N 个模块，输出必须覆盖全部 N 个模块
  - 只输出一个 JSON 对象，不要其他内容。禁止把多个对象拼在一起：{...}{...} 是错的，必须合并为 {... , ...}`;


const R3_FUNCTION_PROMPT = `你是产品经理。根据项目简报和已拆解的子模块，为每个子模块识别功能点。

## 功能层的定位：承上启下
功能层是业务价值和技术实现的衔接层，是拆解中最关键的一层。

## 功能的定义与粒度标准
### 是什么
功能是用户可感知的完整业务能力，以"一个完整的用户任务/业务动作闭环"为单位。

### 粒度合格标准
- **闭环原则**：有明确的触发者、输入、业务目标和输出结果，自身是完整的业务闭环
- **独立验证**：可独立测试、独立验收，对应一个完整的用户故事/用例
- **一句话职责**：可用一句话说清该功能做什么，不含"和""以及"等并列词
- **子功能数量**：每个功能下属包含 2-8 个子功能

### 过粗信号（需要拆分）
- 把多个用户任务合并为一个功能（如"登录注册"算一个功能）

### 过细信号（需要合并）
- 把操作步骤（如"输入手机号"）定义为功能

---

以子模块"仪表盘"为例：
  "核心指标概览"、"数据趋势图表"、"异常告警提醒"、"快捷操作入口"、"自定义看板布局"

以子模块"用户管理"为例：
  "用户列表查询"、"角色与权限分配"、"账号启停管理"、"操作日志审计"、"批量导入导出"

以子模块"技术架构设计"为例：
  "技术栈选型"、"系统分层设计"、"模块间通信方案"、"第三方服务集成方案"

## 输出格式（紧凑映射）
纯 JSON 对象，key 为子模块名，value 为该子模块的功能数组：
{"子模块1": ["功能a", "功能b"], "子模块2": ["功能c"]}

## 规则
- 每个子模块承载 2-5 个功能（极简单情况可以只有 1 个）
- 功能命名回答"用户能做什么"（业务）或"设计要解决什么"（design）
- 输入有 N 个子模块，输出必须覆盖全部 N 个子模块
  - 只输出一个 JSON 对象，不要其他内容。禁止把多个对象拼在一起：{...}{...} 是错的，必须合并为 {... , ...}`;


const R4_LEAF_PROMPT = `你是技术规格撰写者。根据项目简报和已识别的功能，为每个功能生成子功能和详细描述。

## 子功能的定位：最小原子操作
子功能是功能内的最小原子操作单元，是不可再拆分为独立业务动作的单一执行步骤。再拆就会变成代码逻辑/字段校验/实现细节，失去独立业务意义。

## 粒度控制标准
### 合格标准
- **单一职责**：只做一件事，职责可用一句话说清
- **独立输入输出**：有明确的输入和输出，可被其他功能复用
- **不是代码细节**：停留在业务动作级别，不涉及"判断长度""校验格式"等实现级内容

### 过粗信号（需要拆分）
- 把多个连续操作合并为一个子功能（如"填写信息并提交"）

### 过细信号（需要合并）
- 拆到了代码实现级（如"判断手机号长度"、"校验密码字符类型"、"数据库insert操作"）
- 一个功能拆出了 5 个以上子功能 → 检查是否过细

## 拆解逻辑
1. **按实现维度**：一个功能的交付需要前端页面、后端接口、数据处理等维度
2. **按子场景**：按功能的用户操作路径或业务子场景拆解

以功能"用户列表查询"为例：
  "多条件筛选搜索" → "支持按角色、状态、注册时间等多维度组合筛选用户，结果实时刷新"
  "列表排序与分页" → "支持按姓名、时间等字段排序，大数据量下分页加载流畅"
  "筛选方案保存" → "用户可将常用筛选条件保存为预设，下次一键应用"

## 输出格式（紧凑映射）
纯 JSON 对象，key 为功能名，value 为 {子功能名: 功能描述} 的对象：
{"功能a": {"子功能x": "描述x", "子功能y": "描述y"}, "功能b": {"子功能z": "描述z"}}

## 规则
- 每个功能通常拆解为 1-3 个子功能。复杂功能可以到 5 个，超过 5 个检查是否过细
- 子功能名称必须比功能更具体（不可与功能名完全相同）
- 描述为 20-50 字，包含实现内容和业务价值
- 输入有 N 个功能，输出必须覆盖全部 N 个功能
  - 只输出一个 JSON 对象，不要其他内容。禁止把多个对象拼在一起：{...}{...} 是错的，必须合并为 {... , ...}`;


// ===========================================================================
// Layer parsers / validators — no category, compact output
// ===========================================================================

function parseModules(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error("Decomposer R1: expected JSON array");
  }
  const modules = raw.map((item, i) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Decomposer R1: invalid module at index ${i} — must be non-empty string`);
    }
    return item.trim();
  });
  if (modules.length < 2) {
    throw new Error("Decomposer R1: expected at least 2 modules");
  }
  const dupes = modules.filter((m, i) => modules.indexOf(m) !== i);
  if (dupes.length > 0) {
    throw new Error(`Decomposer R1: duplicate modules — ${dupes.join(", ")}`);
  }
  return modules;
}

/**
 * Parses R2 output: {"模块A": ["子1","子2"], "模块B": ["子3"]}
 * Returns flat [module, sub_module] pairs.
 */
function parseSubModules(raw: unknown, parentModules: string[]): [string, string][] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Decomposer R2: expected JSON object (not array)");
  }
  const obj = raw as Record<string, unknown>;
  const pairs: [string, string][] = [];

  for (const [module, children] of Object.entries(obj)) {
    if (!parentModules.includes(module)) {
      throw new Error(`Decomposer R2: unknown module "${module}" — not in R1 output`);
    }
    if (!Array.isArray(children)) {
      throw new Error(`Decomposer R2: value for "${module}" is not an array`);
    }
    for (const child of children) {
      if (typeof child !== "string" || !child.trim()) {
        throw new Error(`Decomposer R2: invalid sub_module under "${module}"`);
      }
      pairs.push([module, child.trim()]);
    }
  }

  const covered = new Set(pairs.map((p) => p[0]));
  const missing = parentModules.filter((m) => !covered.has(m));
  if (missing.length > 0) {
    throw new Error(`Decomposer R2: missing sub-modules for: ${missing.join(", ")}`);
  }
  return pairs;
}

/**
 * Parses R3 output: {"子模块1": ["功能a","功能b"], "子模块2": ["功能c"]}
 * Returns flat [sub_module, function] pairs.
 */
function parseFunctions(
  raw: unknown,
  parentPairs: [string, string][],
): [string, string][] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Decomposer R3: expected JSON object (not array)");
  }
  const obj = raw as Record<string, unknown>;
  const pairs: [string, string][] = [];

  const parentSubModules = new Set(parentPairs.map((p) => p[1]));
  for (const [subModule, children] of Object.entries(obj)) {
    if (!parentSubModules.has(subModule)) {
      throw new Error(`Decomposer R3: unknown sub_module "${subModule}" — not in R2 output`);
    }
    if (!Array.isArray(children)) {
      throw new Error(`Decomposer R3: value for "${subModule}" is not an array`);
    }
    for (const child of children) {
      if (typeof child !== "string" || !child.trim()) {
        throw new Error(`Decomposer R3: invalid function under "${subModule}"`);
      }
      pairs.push([subModule, child.trim()]);
    }
  }

  const covered = new Set(pairs.map((p) => p[0]));
  const missing = [...parentSubModules].filter((s) => !covered.has(s));
  if (missing.length > 0) {
    throw new Error(`Decomposer R3: missing functions for: ${missing.join(", ")}`);
  }
  return pairs;
}

/**
 * Parses R4 output: {"功能a": {"子功能x":"描述x","子功能y":"描述y"}, ...}
 * Returns flat [function, sub_function, description] triples.
 */
function parseLeaves(
  raw: unknown,
  parentFuncs: [string, string][],
): [string, string, string][] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Decomposer R4: expected JSON object (not array)");
  }
  const obj = raw as Record<string, Record<string, unknown>>;
  const triples: [string, string, string][] = [];

  const parentFunctionSet = new Set(parentFuncs.map((p) => p[1]));

  for (const [func, children] of Object.entries(obj)) {
    if (!parentFunctionSet.has(func)) {
      throw new Error(`Decomposer R4: unknown function "${func}" — not in R3 output`);
    }
    if (!children || typeof children !== "object" || Array.isArray(children)) {
      throw new Error(`Decomposer R4: value for "${func}" is not an object`);
    }

    for (const [subFunc, desc] of Object.entries(children)) {
      if (typeof subFunc !== "string" || !subFunc.trim()) {
        throw new Error(`Decomposer R4: empty sub_function key under "${func}"`);
      }
      if (subFunc === func) {
        throw new Error(
          `Decomposer R4: sub_function "${subFunc}" must differ from function "${func}"`,
        );
      }
      if (typeof desc !== "string" || !desc.trim()) {
        throw new Error(`Decomposer R4: empty description for "${func}" → "${subFunc}"`);
      }
      triples.push([func, subFunc.trim(), desc.trim()]);
    }
  }

  if (triples.length === 0) {
    throw new Error("Decomposer R4: no valid leaf triples generated");
  }

  const covered = new Set(triples.map((t) => t[0]));
  const missing = [...parentFunctionSet].filter((f) => !covered.has(f));
  if (missing.length > 0) {
    throw new Error(`Decomposer R4: missing leaves for: ${missing.join(", ")}`);
  }

  return triples;
}

// ===========================================================================
// Final stitch — reconstructs QuotationRow[] from the forward-reference chain
// ===========================================================================

function stitch(
  r2Pairs: [string, string][],       // [module, sub_module]
  r3Pairs: [string, string][],       // [sub_module, function]
  r4Triples: [string, string, string][], // [function, sub_function, description]
): QuotationRow[] {
  // R3: group functions by sub_module
  const r3Map = new Map<string, string[]>();
  for (const [sub, func] of r3Pairs) {
    let arr = r3Map.get(sub);
    if (!arr) r3Map.set(sub, arr = []);
    arr.push(func);
  }

  // R4: group leaves by function
  const r4Map = new Map<string, [string, string][]>();
  for (const [func, subFunc, desc] of r4Triples) {
    let arr = r4Map.get(func);
    if (!arr) r4Map.set(func, arr = []);
    arr.push([subFunc, desc]);
  }

  const rows: QuotationRow[] = [];
  for (const [module, sub] of r2Pairs) {           // R2: [module, sub_module]
    for (const func of r3Map.get(sub) ?? []) {     // R3: [function]
      for (const [subFunc, desc] of r4Map.get(func) ?? []) { // R4: [sub_func, desc]
        rows.push({
          seq: 0,
          module,
          sub_module: sub,
          function: func,
          sub_function: subFunc,
          description: desc,
          category: "feature",
          trades: {},
          remark: "",
        });
      }
    }
  }

  rows.forEach((r, i) => { r.seq = i + 1; });
  return rows;
}

// ===========================================================================
// Prompt builders — feed prior layer output + brief to each round
// ===========================================================================

function buildR2Prompt(modules: string[], brief: string): string {
  return [
    `模块列表（共 ${modules.length} 个）：`,
    JSON.stringify(modules),
    "",
    "项目简报：",
    brief,
    "",
    "请为每个模块拆解子模块。输出格式：{\"模块A\":[\"子1\",\"子2\"], \"模块B\":[\"子3\"]}",
  ].join("\n");
}

function buildR3Prompt(r2Pairs: [string, string][], brief: string): string {
  // Group sub-modules by module for context
  const moduleMap = new Map<string, string[]>();
  for (const [mod, sub] of r2Pairs) {
    if (!moduleMap.has(mod)) moduleMap.set(mod, []);
    moduleMap.get(mod)!.push(sub);
  }

  const hierarchy = [...moduleMap.entries()]
    .map(([mod, subs]) => `  ${mod} → ${subs.join("、")}`)
    .join("\n");

  // Extract unique sub-module names as JSON array for LLM reference
  const subNames = r2Pairs.map((p) => p[1]);

  return [
    "模块-子模块关系：",
    hierarchy,
    "",
    "项目简报：",
    brief,
    "",
    `请为以下 ${subNames.length} 个子模块识别功能点。输出格式：{"子模块名":["功能1","功能2"]}`,
    `子模块列表：${JSON.stringify(subNames)}`,
  ].join("\n");
}

function buildR4Prompt(
  r3Pairs: [string, string][],
  r2Pairs: [string, string][],
  brief: string,
): string {
  // Reconstruct full hierarchy for context
  const subToModule = new Map<string, string>();
  for (const [mod, sub] of r2Pairs) subToModule.set(sub, mod);

  const funcToSub = new Map<string, string>();
  for (const [sub, func] of r3Pairs) funcToSub.set(func, sub);

  // Group functions by (module, sub_module)
  const grouped = new Map<string, string[]>();
  for (const [, func] of r3Pairs) {
    const sub = funcToSub.get(func)!;
    const mod = subToModule.get(sub)!;
    const key = `${mod} → ${sub}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(func);
  }

  const hierarchy = [...grouped.entries()]
    .map(([key, funcs]) => `  ${key} → ${funcs.join("、")}`)
    .join("\n");

  const funcNames = r3Pairs.map((p) => p[1]);

  return [
    "完整层级关系：",
    hierarchy,
    "",
    "项目简报：",
    brief,
    "",
    `请为以下 ${funcNames.length} 个功能生成子功能和描述。输出格式：{"功能名":{"子功能名":"描述",...}}`,
    `功能列表：${JSON.stringify(funcNames)}`,
  ].join("\n");
}

// ===========================================================================
// BFS orchestrator — 4 rounds, each focusing on one hierarchy level
// ===========================================================================

export async function runDecomposer(
  model: BaseChatModel,
  sessionId: string,
  input: { structuredBrief: string },
  onProgress?: (progress: DecomposerProgress) => void,
): Promise<DecomposerOutput> {
  const brief = input.structuredBrief;
  if (!brief || !brief.trim()) {
    throw new Error("Decomposer: structuredBrief is empty");
  }

  logger.info("decomposer start (BFS)", { briefLen: brief.length });

  const overrides = getSessionConfig(sessionId)?.promptOverrides;
  const r1Prompt = resolvePrompt("decomposer_r1", overrides) || R1_MODULE_PROMPT;
  const r2Prompt = resolvePrompt("decomposer_r2", overrides) || R2_SUB_MODULE_PROMPT;
  const r3Prompt = resolvePrompt("decomposer_r3", overrides) || R3_FUNCTION_PROMPT;
  const r4Prompt = resolvePrompt("decomposer_r4", overrides) || R4_LEAF_PROMPT;

  // ── Round 1: Modules (flat string array) ──
  onProgress?.({ stage: "识别产品模块", round: 0, totalRounds: 4, message: "正在分析产品模块划分..." });
  const r1Raw = await invokeAndExtractJson(
    model,
    "decomposer_r1",
    r1Prompt,
    `项目简报：\n\n${brief}\n\n请列出所有一级模块。输出格式：["模块A", "模块B"]`,
  );
  const modules = parseModules(r1Raw);
  onProgress?.({ stage: "识别产品模块", round: 1, totalRounds: 4, message: `已识别 ${modules.length} 个模块` });

  // ── Round 2: Sub-Modules ({module → [sub_modules]}) ──
  onProgress?.({ stage: "拆解子模块", round: 1, totalRounds: 4, message: "正在拆解子模块..." });
  const r2Raw = await invokeAndExtractJson(
    model,
    "decomposer_r2",
    r2Prompt,
    buildR2Prompt(modules, brief),
  );
  const r2Pairs = parseSubModules(r2Raw, modules);
  const subModules = r2Pairs;
  onProgress?.({ stage: "拆解子模块", round: 2, totalRounds: 4, message: `已拆解 ${r2Pairs.length} 个子模块` });

  // ── Round 3: Functions ({sub_module → [functions]}) ──
  onProgress?.({ stage: "识别功能点", round: 2, totalRounds: 4, message: "正在识别功能点..." });
  const r3Raw = await invokeAndExtractJson(
    model,
    "decomposer_r3",
    r3Prompt,
    buildR3Prompt(r2Pairs, brief),
  );
  const r3Pairs = parseFunctions(r3Raw, r2Pairs);
  onProgress?.({ stage: "识别功能点", round: 3, totalRounds: 4, message: `已识别 ${r3Pairs.length} 个功能点` });

  // ── Round 4: Leaves ({function → {sub_function: description}}) ──
  onProgress?.({ stage: "生成子功能详情", round: 3, totalRounds: 4, message: "正在生成子功能详情..." });
  const r4Raw = await invokeAndExtractJson(
    model,
    "decomposer_r4",
    r4Prompt,
    buildR4Prompt(r3Pairs, r2Pairs, brief),
  );
  const r4Triples = parseLeaves(r4Raw, r3Pairs);
  onProgress?.({ stage: "生成子功能详情", round: 4, totalRounds: 4, message: `已生成 ${r4Triples.length} 个子功能` });

  // ── Stitch: reconstruct QuotationRow[] from the forward-reference chain ──
  const rows = stitch(r2Pairs, r3Pairs, r4Triples);

  logger.info("decomposer complete (BFS)", {
    modules: modules.length,
    subModules: r2Pairs.length,
    functions: r3Pairs.length,
    rows: rows.length,
  });

  return { rows };
}
