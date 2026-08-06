/**
 * Decomposer orchestrator — agent-based BFS decomposition with shared CRUD table.
 *
 * Unlike the old pipeline (4 LLM calls outputting full-layer JSON), each round
 * is now a LangChain agent with level-scoped CRUD tools operating on a shared
 * DecomposerTree. Full decomposition and modification rounds share the same
 * code path — the difference is purely whether the table starts empty or
 * populated from previousRows.
 *
 * Modification propagation:
 *   - Rounds are executed starting from the first non-empty roundInstruction.
 *   - Rounds WITH instructions get FULL table context at their level.
 *   - Rounds WITHOUT instructions (but downstream from a modified round) get
 *     PRUNED context: only rows affected by parent-level changes.
 *   - R4 pruning is two-level: (a) which sub-module agents are spawned,
 *     (b) what rows each spawned agent sees.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { DecomposerProgress } from "@/lib/agent/state";
import type { DecomposerOutput } from "@/lib/agent/state";
import type { QuotationRow } from "@/lib/types";
import { getSessionConfig } from "@/lib/session-config";
import { resolvePrompt } from "@/lib/prompt-defaults";
import { DecomposerTree, type RoundChangeSet, type LevelRow } from "./table";
import {
  runR1Agent,
  runR2Agent,
  runR3Agent,
  runR4AgentForSubModule,
  type RoundResult,
} from "./agents";
import { HumanMessage } from "@langchain/core/messages";
import { extractStringContent } from "@/lib/agent/llm";
import log from "@/lib/logger";

const logger = log.child({ agent: "decomposer" });

function firstLine(s: string): string {
  const end = s.indexOf("\n");
  if (end === -1) return s;
  return `${s.slice(0, end)}… (${s.length} chars)`;
}

function determineStartRound(
  ri?: { r1?: string; r2?: string; r3?: string; r4?: string },
): number {
  if (!ri) return 1;
  if (ri.r1) return 1;
  if (ri.r2) return 2;
  if (ri.r3) return 3;
  if (ri.r4) return 4;
  return 1;
}

function resolveAgentPrompt(level: 1 | 2 | 3 | 4, sessionId: string): string {
  const overrides = getSessionConfig(sessionId)?.promptOverrides;
  return resolvePrompt(`decomposer_r${level}_agent`, overrides);
}

// ---------------------------------------------------------------------------
// R4 instruction → sub_module target resolution (lightweight LLM call)
// ---------------------------------------------------------------------------

interface SubModuleRef {
  module: string;
  subModule: string;
}

const R4TargetSchema = `{"scope":"specific"|"all","targets":["模块::子模块",...]}`;

async function resolveR4InstructionTargets(
  model: BaseChatModel,
  instruction: string,
  allSubModules: SubModuleRef[],
  parentAffectedKeys: Set<string>,
  config?: RunnableConfig,
): Promise<Set<string> | null> {
  // null = broad instruction, applies to ALL sub_modules
  const keyList = allSubModules
    .map(({ module, subModule }) => `${module}::${subModule}`)
    .join("\n");

  const prompt = [
    "# 任务",
    "判断以下修改指令需要应用于哪些子模块（module::sub_module格式）。",
    "",
    "## 修改指令",
    instruction,
    "",
    "## 所有可用的子模块",
    keyList,
    "",
    "## 父轮变更已影响的子模块",
    [...parentAffectedKeys].join("\n") || "(无)",
    "",
    "## 输出规则",
    `返回纯JSON（不含markdown代码块），格式: ${R4TargetSchema}`,
    '- 若指令提到"全部"、"所有"、"每个"、"统一"等全局词 → {"scope":"all"}',
    "- 若指令指向特定子模块 → {\"scope\":\"specific\",\"targets\":[\"模块::子模块\",...]}",
    "- 父轮变更已影响的子模块如果指令也涉及，也需要加入targets",
    "- targets中的key必须与上面列表中完全一致",
  ].join("\n");

  logger.info("R4 resolving instruction targets via LLM", {
    instruction: firstLine(instruction),
    subModuleCount: allSubModules.length,
    parentAffectedCount: parentAffectedKeys.size,
  });

  try {
    // MUST suppress callbacks — this LLM call runs inside the LangGraph
    // agent's async context and inherits its streaming callbacks via
    // AsyncLocalStorage. Without explicit suppression, the response text
    // leaks to the frontend as SSE events.
    const response = await model.invoke(
      [new HumanMessage(prompt)],
      { callbacks: [], signal: config?.signal },
    );
    const text = extractStringContent(response.content) || JSON.stringify(response.content);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn("R4 target resolution: no JSON found in LLM response, falling back to all");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.scope === "all") {
      logger.info("R4 target resolution: broad instruction → all sub_modules");
      return null;
    }

    if (parsed.scope === "specific" && Array.isArray(parsed.targets) && parsed.targets.length > 0) {
      const stringTargets: string[] = (parsed.targets as unknown[]).filter((t): t is string => typeof t === "string");
      const targets = new Set(stringTargets);
      logger.info("R4 target resolution: specific targets", {
        count: targets.size,
        targets: [...targets].join(", "),
      });
      return targets;
    }

    logger.warn("R4 target resolution: unexpected response shape, falling back to all", { parsed });
    return null;
  } catch (err) {
    logger.warn("R4 target resolution failed, falling back to all", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runDecomposer(
  model: BaseChatModel,
  sessionId: string,
  input: {
    structuredBrief: string;
    /** Per-round instructions. Only rounds that need modification need a key. */
    roundInstructions?: {
      r1?: string;
      r2?: string;
      r3?: string;
      r4?: string;
    };
    previousRows?: QuotationRow[];
  },
  onProgress?: (progress: DecomposerProgress) => void,
  config?: RunnableConfig,
): Promise<DecomposerOutput> {
  const brief = input.structuredBrief;
  if (!brief || !brief.trim()) {
    throw new Error("Decomposer: structuredBrief is empty");
  }

  const ri = input.roundInstructions;
  const startRound = determineStartRound(ri);

  logger.info("decomposer start (agent-based)", {
    brief: firstLine(brief),
    hasRoundInstructions: !!ri,
    hasPreviousRows: !!input.previousRows?.length,
    startRound,
  });

  // 1. Initialize table
  const table = DecomposerTree.fromPreviousRows(input.previousRows);

  // 2. Track changes per round for downstream pruning
  const roundChanges: (RoundChangeSet | null)[] = [null, null, null, null, null]; // 1-indexed

  // 3. Run rounds sequentially
  for (let round = 1; round <= 4; round++) {
    if (round < startRound) continue;

    const instruction = ri?.[`r${round}` as keyof typeof ri];
    const hasInstruction = !!instruction;
    const systemPrompt = resolveAgentPrompt(round as 1 | 2 | 3 | 4, sessionId);

    let result: RoundResult;

    switch (round) {
      case 1: {
        onProgress?.({
          stage: "识别产品模块",
          round: 0,
          totalRounds: 4,
          message: instruction
            ? "正在按指令调整模块..."
            : "正在分析产品模块划分...",
        });

        result = await runR1Agent(model, table, brief, systemPrompt, instruction, config);

        roundChanges[1] = table.buildChangeSet(result.changedIds);

        const modules = table.getModuleNames();
        onProgress?.({
          stage: "识别产品模块",
          round: 1,
          totalRounds: 4,
          message: `已识别 ${modules.length} 个模块`,
        });
        break;
      }

      case 2: {
        onProgress?.({
          stage: "拆解子模块",
          round: 1,
          totalRounds: 4,
          message: instruction
            ? "正在按指令调整子模块..."
            : "正在拆解子模块...",
        });

        result = await runR2Agent(model, table, brief, systemPrompt, instruction, config);

        roundChanges[2] = table.buildChangeSet(result.changedIds);

        const r2Count = table.getRowsAtLevel(2).length;
        onProgress?.({
          stage: "拆解子模块",
          round: 2,
          totalRounds: 4,
          message: `已拆解 ${r2Count} 个子模块`,
        });
        break;
      }

      case 3: {
        onProgress?.({
          stage: "识别功能点",
          round: 2,
          totalRounds: 4,
          message: instruction
            ? "正在按指令调整功能点..."
            : "正在识别功能点...",
        });

        // R3 context: full if has instruction, pruned otherwise
        let contextRows: LevelRow[];
        if (hasInstruction) {
          contextRows = table.getRowsAtLevel(2); // R2-level rows (sub_module rows)
        } else {
          const parentChanges = roundChanges[round - 1];
          if (parentChanges) {
            contextRows = table.getRowsAtLevelPruned(3, parentChanges);
          } else {
            contextRows = table.getRowsAtLevel(2);
          }
        }

        result = await runR3Agent(model, table, brief, contextRows, systemPrompt, instruction, config);

        roundChanges[3] = table.buildChangeSet(result.changedIds);

        const r3Count = table.getRowsAtLevel(3).length;
        onProgress?.({
          stage: "识别功能点",
          round: 3,
          totalRounds: 4,
          message: `已识别 ${r3Count} 个功能点`,
        });
        break;
      }

      case 4: {
        onProgress?.({
          stage: "生成子功能详情",
          round: 3,
          totalRounds: 4,
          message: "正在生成子功能详情...",
        });

        const parentChanges = roundChanges[round - 1];
        const allR3Rows = table.getRowsAtLevel(3);
        const allSubModuleGroups = table.groupBySubModule(allR3Rows);

        // Always collect parent-change affected keys (regardless of hasInstruction)
        const parentAffectedKeys = parentChanges
          ? table.getAffectedSubModuleKeys(parentChanges)
          : new Set<string>();
        const parentAffectedFunctionKeys = parentChanges?.affectedFunctions;

        // When R4 has instruction, use LLM to determine which sub_modules the
        // instruction targets. null = broad instruction (apply to all).
        let instructionTargetedKeys: Set<string> | null | undefined;
        if (hasInstruction) {
          const allSubModuleRefs: SubModuleRef[] = [];
          for (const [, { module, subModule }] of allSubModuleGroups) {
            allSubModuleRefs.push({ module, subModule });
          }
          instructionTargetedKeys = await resolveR4InstructionTargets(
            model, instruction!, allSubModuleRefs, parentAffectedKeys, config,
          );

          // Safety net: LLM returned empty targets + no parent changes → fallback to all
          if (instructionTargetedKeys != null &&
              instructionTargetedKeys.size === 0 &&
              parentAffectedKeys.size === 0) {
            logger.warn("R4 instruction matched no sub_modules and no parent changes — falling back to all");
            instructionTargetedKeys = null;
          }
        }

        // Build R4 tasks
        const r4Tasks: Array<{
          index: number;
          module: string;
          subModule: string;
          rows: LevelRow[];
          instructionTargeted: boolean;
        }> = [];

        for (const [, { module, subModule }] of allSubModuleGroups) {
          const key = `${module}::${subModule}`;

          // Determine if this sub_module should run an R4 agent
          if (instructionTargetedKeys != null) {
            if (!parentAffectedKeys.has(key) && !instructionTargetedKeys.has(key)) continue;
          } else if (hasInstruction && instructionTargetedKeys === null) {
          } else if (!hasInstruction && parentAffectedKeys.size > 0) {
            if (!parentAffectedKeys.has(key)) continue;
          }

          // Determine row context
          let rows: LevelRow[];
          const isInstructionTargeted = instructionTargetedKeys?.has(key) ?? false;
          const isParentAffected = parentAffectedKeys.has(key);

          if (isInstructionTargeted) {
            rows = table.getRowsForSubModule(module, subModule);
          } else if (isParentAffected && parentAffectedFunctionKeys?.size) {
            rows = table.getRowsForSubModule(module, subModule, parentAffectedFunctionKeys);
          } else {
            rows = table.getRowsForSubModule(module, subModule);
          }

          if (rows.length === 0) continue;
          r4Tasks.push({ index: r4Tasks.length + 1, module, subModule, rows, instructionTargeted: isInstructionTargeted });
        }

        const R4_CONCURRENCY = 6;
        const totalR4 = r4Tasks.length;
        const r4TaskFactories = r4Tasks.map(
          ({ index, module, subModule, rows, instructionTargeted }) =>
            async () => {
              const taskInstruction = instructionTargeted ? instruction : undefined;
              try {
                const r4Result = await runR4AgentForSubModule(
                  model,
                  table,
                  module,
                  subModule,
                  rows,
                  brief,
                  systemPrompt,
                  taskInstruction,
                  index,
                  totalR4,
                  config,
                );
                return { module, subModule, ...r4Result };
              } catch (err) {
                const enriched = new Error(
                  `R4[${module}→${subModule}]: ${err instanceof Error ? err.message : String(err)}`,
                );
                (enriched as any).module = module;
                (enriched as any).subModule = subModule;
                throw enriched;
              }
            },
        );

        const r4Settled: PromiseSettledResult<Awaited<ReturnType<(typeof r4TaskFactories)[number]>>>[] = [];
        {
          const running = new Set<Promise<void>>();
          for (const factory of r4TaskFactories) {
            const p = factory()
              .then((value) => { r4Settled.push({ status: "fulfilled", value }); })
              .catch((reason) => { r4Settled.push({ status: "rejected", reason }); });
            running.add(p);
            if (running.size >= R4_CONCURRENCY) await Promise.race(running);
            for (const r of running) { r.then(() => running.delete(r), () => running.delete(r)); }
          }
          await Promise.all(running);
        }

        const r4AllResults: Array<{
          module: string;
          subModule: string;
          changedIds: number[];
          rowCount: number;
        }> = [];
        const r4Failures: string[] = [];

        for (const entry of r4Settled) {
          if (entry.status === "fulfilled") {
            r4AllResults.push(entry.value);
          } else {
            const mod = (entry.reason as any)?.module ?? "?";
            const sub = (entry.reason as any)?.subModule ?? "?";
            const errMsg = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
            r4Failures.push(`${mod}→${sub}`);
            logger.warn(`R4 task failed for ${mod}→${sub}`, { error: errMsg });
          }
        }

        if (r4Failures.length > 0) {
          logger.warn(`${r4Failures.length}/${r4Settled.length} R4 tasks failed: ${r4Failures.join(", ")}`);
        }
        if (r4AllResults.length === 0 && r4Settled.length > 0) {
          throw new Error("All R4 sub-module tasks failed — cannot produce complete quotation");
        }

        const allChangedIds = r4AllResults.flatMap((r) => r.changedIds);
        roundChanges[4] = table.buildChangeSet(allChangedIds);

        const r4TriplesCount = r4AllResults.reduce((sum, r) => sum + r.rowCount, 0);
        onProgress?.({
          stage: "生成子功能详情",
          round: 4,
          totalRounds: 4,
          message: r4Failures.length > 0
            ? `已生成 ${r4TriplesCount} 个子功能（${r4AllResults.length}/${r4Settled.length} 块成功，${r4Failures.length} 失败）`
            : `已生成 ${r4TriplesCount} 个子功能（${r4Tasks.length} 块并行）`,
        });
        break;
      }
    }
  }

  // 4. Convert to QuotationRow[]
  const rows = table.toQuotationRows();

  if (rows.length === 0) {
    logger.warn("decomposer produced empty result", {
      totalRows: table.buildLevelSnapshot(4).size,
      moduleCount: table.getModuleNames().length,
      startRound,
    });
  }

  logger.info("decomposer complete (agent-based)", {
    rows: rows.length,
  });

  return { rows };
}
