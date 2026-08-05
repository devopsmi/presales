/**
 * Tool factories for decomposer agents (R1-R4).
 *
 * Each level's agent receives CRUD tools scoped to its column:
 *   R1: read/add/delete/rename modules
 *   R2: read/add/delete/rename sub_modules (per module)
 *   R3: read/add/delete/rename functions (per sub_module)
 *   R4: read/add/delete/update leaves (per function)
 *
 * Every tool returns JSON so the agent can parse structured results.
 */
import { tool, createMiddleware } from "langchain";
import { z } from "zod";
import { DecomposerTree } from "./table";
import type { LevelRow } from "./table";
import log from "@/lib/logger";

// ---------------------------------------------------------------------------
// View helpers — format rows for LLM consumption
// ---------------------------------------------------------------------------

function formatModuleList(modules: string[]): string {
  if (!modules.length) return "(暂无模块)";
  return modules.map((m, i) => `  ${i}. ${m}`).join("\n");
}

function formatLevelRows(rows: LevelRow[], level: number): string {
  if (!rows.length) {
    if (level === 1) return "(暂无模块 — 请使用 add_modules 添加)";
    if (level === 2)
      return "(暂无子模块 — 请使用 add_sub_modules 添加)";
    if (level === 3)
      return "(暂无功能点 — 请使用 add_functions 添加)";
    return "(暂无子功能 — 请使用 add_leaves 添加)";
  }

  const lines: string[] = [];
  for (const r of rows) {
    const parts: string[] = [`[${r.id}]`];
    parts.push(r.module);
    if (level >= 2) parts.push(`→ ${r.sub_module}`);
    if (level >= 3) parts.push(`→ ${r.function}`);
    if (level >= 4) {
      parts.push(`→ ${r.sub_function}`);
      if (r.description) parts.push(`: ${r.description}`);
    }
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}

function formatSubModuleRows(
  pairs: { module: string; sub_module: string }[],
): string {
  if (!pairs.length) return "(暂无子模块)";
  const grouped = new Map<string, string[]>();
  for (const { module, sub_module } of pairs) {
    const arr = grouped.get(module) ?? [];
    arr.push(sub_module);
    grouped.set(module, arr);
  }
  const lines: string[] = [];
  for (const [mod, subs] of grouped) {
    lines.push(`### ${mod}`);
    for (const sub of subs) lines.push(`  - ${sub}`);
  }
  return lines.join("\n");
}

function formatFunctionRows(
  triples: { module: string; sub_module: string; function: string }[],
): string {
  if (!triples.length) return "(暂无功能点)";
  const grouped = new Map<string, Map<string, string[]>>();
  for (const { module, sub_module, function: func } of triples) {
    let sm = grouped.get(module);
    if (!sm) {
      sm = new Map();
      grouped.set(module, sm);
    }
    const arr = sm.get(sub_module) ?? [];
    arr.push(func);
    sm.set(sub_module, arr);
  }
  const lines: string[] = [];
  for (const [mod, sm] of grouped) {
    lines.push(`### ${mod}`);
    for (const [sub, funcs] of sm) {
      lines.push(`  - ${sub}`);
      for (const func of funcs) lines.push(`    - ${func}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// R1 Tools — module level
// ---------------------------------------------------------------------------

export function buildR1Tools(table: DecomposerTree) {
  return [
    tool(
      async () => {
        const modules = table.getModuleNames();
        return JSON.stringify({
          count: modules.length,
          modules,
          text: formatModuleList(modules),
        });
      },
      {
        name: "read_modules",
        description: "查看当前所有一级模块。返回模块列表。",
        schema: z.object({}),
      },
    ),

    tool(
      async ({ modules }: { modules: string[] }) => {
        const indices = table.addModules(modules);
        const allModules = table.getModuleNames();
        return JSON.stringify({
          added: indices.length,
          total: allModules.length,
          modules: allModules,
          text: `已新增 ${indices.length} 个模块。当前共 ${allModules.length} 个模块：\n${formatModuleList(allModules)}`,
        });
      },
      {
        name: "add_modules",
        description:
          "新增一级模块。传入模块名数组，重复的模块名会被跳过。",
        schema: z.object({
          modules: z
            .array(z.string())
            .describe("要新增的模块名列表，如 ['C端小程序', '运营后台']"),
        }),
      },
    ),

    tool(
      async ({ modules }: { modules: string[] }) => {
        table.deleteModules(modules);
        const remaining = table.getModuleNames();
        return JSON.stringify({
          deleted: modules.length,
          remaining: remaining.length,
          modules: remaining,
          text: `已删除 ${modules.length} 个模块（含其下所有子模块/功能/子功能）。当前共 ${remaining.length} 个模块：\n${formatModuleList(remaining)}`,
        });
      },
      {
        name: "delete_modules",
        description:
          "删除模块。会级联删除该模块下的所有子模块、功能点和子功能。",
        schema: z.object({
          modules: z
            .array(z.string())
            .describe("要删除的模块名列表"),
        }),
      },
    ),

    tool(
      async ({ old_name, new_name }: { old_name: string; new_name: string }) => {
        table.renameModule(old_name, new_name);
        return JSON.stringify({
          success: true,
          text: `已将模块"${old_name}"重命名为"${new_name}"。`,
        });
      },
      {
        name: "rename_module",
        description: "重命名一个模块。所有该模块下的子模块/功能/子功能自动同步。",
        schema: z.object({
          old_name: z.string().describe("当前模块名"),
          new_name: z.string().describe("新的模块名"),
        }),
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// R2 Tools — sub_module level
// ---------------------------------------------------------------------------

export function buildR2Tools(table: DecomposerTree) {
  return [
    tool(
      async () => {
        const subs = table.getSubModulePairs();
        return JSON.stringify({
          count: subs.length,
          text: formatSubModuleRows(subs),
        });
      },
      {
        name: "read_sub_modules",
        description:
          "查看当前所有子模块。按父模块分组展示。",
        schema: z.object({}),
      },
    ),

    tool(
      async ({
        module,
        sub_modules,
      }: {
        module: string;
        sub_modules: string[];
      }) => {
        const indices = table.addSubModules(module, sub_modules);
        const all = table.getSubModulePairs();
        return JSON.stringify({
          added: indices.length,
          module,
          text: `已在模块"${module}"下新增 ${indices.length} 个子模块。当前子模块：\n${formatSubModuleRows(all)}`,
        });
      },
      {
        name: "add_sub_modules",
        description:
          "为指定模块新增子模块。子模块名不应与同模块下的已有子模块重复。",
        schema: z.object({
          module: z.string().describe("父模块名，必须是已存在的模块"),
          sub_modules: z
            .array(z.string())
            .describe("子模块名列表"),
        }),
      },
    ),

    tool(
      async ({
        module,
        sub_modules,
      }: {
        module: string;
        sub_modules: string[];
      }) => {
        table.deleteSubModules(module, sub_modules);
        const remaining = table.getSubModulePairs();
        return JSON.stringify({
          deleted: sub_modules.length,
          module,
          text: `已从模块"${module}"下删除 ${sub_modules.length} 个子模块（含其下所有功能/子功能）。当前子模块：\n${formatSubModuleRows(remaining)}`,
        });
      },
      {
        name: "delete_sub_modules",
        description:
          "删除指定子模块。会级联删除其下的所有功能点和子功能。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_modules: z
            .array(z.string())
            .describe("要删除的子模块名列表"),
        }),
      },
    ),

    tool(
      async ({
        module,
        old_name,
        new_name,
      }: {
        module: string;
        old_name: string;
        new_name: string;
      }) => {
        table.renameSubModule(module, old_name, new_name);
        return JSON.stringify({
          success: true,
          text: `已将模块"${module}"下的子模块"${old_name}"重命名为"${new_name}"。`,
        });
      },
      {
        name: "rename_sub_module",
        description: "重命名一个子模块。其下的所有功能/子功能自动同步。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          old_name: z.string().describe("当前子模块名"),
          new_name: z.string().describe("新的子模块名"),
        }),
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// R3 Tools — function level
// ---------------------------------------------------------------------------

export function buildR3Tools(table: DecomposerTree) {
  return [
    tool(
      async () => {
        const rows = table.getRowsAtLevel(3);
        const triples = rows.map((r) => ({
          module: r.module,
          sub_module: r.sub_module!,
          function: r.function!,
        }));
        return JSON.stringify({
          count: triples.length,
          text: formatFunctionRows(triples),
        });
      },
      {
        name: "read_functions",
        description:
          "查看当前所有功能点。按子模块分组展示。",
        schema: z.object({}),
      },
    ),

    tool(
      async ({
        module,
        sub_module,
        functions,
      }: {
        module: string;
        sub_module: string;
        functions: string[];
      }) => {
        const indices = table.addFunctions(module, sub_module, functions);
        const rows = table.getRowsAtLevel(3);
        const triples = rows.map((r) => ({
          module: r.module,
          sub_module: r.sub_module!,
          function: r.function!,
        }));
        return JSON.stringify({
          added: indices.length,
          text: `已在子模块"${module} → ${sub_module}"下新增 ${indices.length} 个功能点。当前功能点：\n${formatFunctionRows(triples)}`,
        });
      },
      {
        name: "add_functions",
        description:
          "为指定子模块新增功能点。功能名不应与同子模块下的已有功能重复。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_module: z.string().describe("子模块名"),
          functions: z
            .array(z.string())
            .describe("功能点名称列表"),
        }),
      },
    ),

    tool(
      async ({
        module,
        sub_module,
        functions,
      }: {
        module: string;
        sub_module: string;
        functions: string[];
      }) => {
        table.deleteFunctions(module, sub_module, functions);
        const rows = table.getRowsAtLevel(3);
        const triples = rows.map((r) => ({
          module: r.module,
          sub_module: r.sub_module!,
          function: r.function!,
        }));
        return JSON.stringify({
          deleted: functions.length,
          text: `已从子模块"${module} → ${sub_module}"下删除 ${functions.length} 个功能点。`,
        });
      },
      {
        name: "delete_functions",
        description:
          "删除指定功能点。会级联删除其下的所有子功能。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_module: z.string().describe("子模块名"),
          functions: z
            .array(z.string())
            .describe("要删除的功能名列表"),
        }),
      },
    ),

    tool(
      async ({
        module,
        sub_module,
        old_name,
        new_name,
      }: {
        module: string;
        sub_module: string;
        old_name: string;
        new_name: string;
      }) => {
        table.renameFunction(module, sub_module, old_name, new_name);
        return JSON.stringify({
          success: true,
          text: `已将功能"${old_name}"重命名为"${new_name}"（${module} → ${sub_module}）。`,
        });
      },
      {
        name: "rename_function",
        description: "重命名一个功能点。其下的所有子功能自动同步。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_module: z.string().describe("子模块名"),
          old_name: z.string().describe("当前功能名"),
          new_name: z.string().describe("新的功能名"),
        }),
      },
    ),

    tool(
      async ({
        module,
        sub_module,
        function: funcName,
      }: {
        module: string;
        sub_module: string;
        function: string;
      }) => {
        table.markFunctionSupport(module, sub_module, funcName);
        return JSON.stringify({
          success: true,
          text: `已将功能点"${module} → ${sub_module} → ${funcName}"标记为支撑域（非代码交付），已移除其下所有子节点。`,
        });
      },
      {
        name: "mark_function_support",
        description:
          "标记一个功能点为支撑域（非代码交付范畴）。标记后该功能点的所有子节点（子功能）将被清除。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_module: z.string().describe("子模块名"),
          function: z.string().describe("要标记为支撑域的功能名"),
        }),
      },
    ),
  ];
}

// ---------------------------------------------------------------------------
// R4 Tools — sub_function + description level
// ---------------------------------------------------------------------------

export function buildR4Tools(table: DecomposerTree) {
  return [
    tool(
      async ({
        module,
        sub_module,
      }: {
        module?: string;
        sub_module?: string;
      }) => {
        const rows = table.getRowsAtLevel(4);
        const leaves = rows
          .filter(
            (r) =>
              (!module || r.module === module) &&
              (!sub_module || r.sub_module === sub_module),
          )
          .map((r) => ({
            id: r.id,
            module: r.module,
            sub_module: r.sub_module,
            function: r.function,
            sub_function: r.sub_function,
            description: r.description,
          }));
        return JSON.stringify({
          count: leaves.length,
          rows: leaves,
          text: formatLevelRows(
            leaves as unknown as LevelRow[],
            4,
          ),
        });
      },
      {
        name: "read_leaves",
        description:
          "查看当前所有子功能及描述。可按模块/子模块过滤。",
        schema: z.object({
          module: z
            .string()
            .optional()
            .describe("按模块名过滤（可选）"),
          sub_module: z
            .string()
            .optional()
            .describe("按子模块名过滤（可选）"),
        }),
      },
    ),

    tool(
      async ({
        module,
        sub_module,
        function: funcName,
        leaves,
      }: {
        module: string;
        sub_module: string;
        function: string;
        leaves: { sub_function: string; description: string }[];
      }) => {
        const indices = table.addLeaves(
          module,
          sub_module,
          funcName,
          leaves,
        );
        return JSON.stringify({
          added: indices.length,
          text: `已在功能"${funcName}"下新增 ${indices.length} 个子功能。`,
        });
      },
      {
        name: "add_leaves",
        description:
          "为指定功能新增子功能及描述。每个叶子包含 sub_function（子功能名）和 description（描述）。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_module: z.string().describe("子模块名"),
          function: z.string().describe("功能名"),
          leaves: z
            .array(
              z.object({
                sub_function: z.string().describe("子功能名"),
                description: z.string().describe("子功能描述"),
              }),
            )
            .describe("子功能列表，每项包含名称和描述"),
        }),
      },
    ),

    tool(
      async ({
        module,
        sub_module,
        function: funcName,
        sub_functions,
      }: {
        module: string;
        sub_module: string;
        function: string;
        sub_functions: string[];
      }) => {
        table.deleteLeaves(module, sub_module, funcName, sub_functions);
        return JSON.stringify({
          deleted: sub_functions.length,
          text: `已从功能"${funcName}"下删除 ${sub_functions.length} 个子功能。`,
        });
      },
      {
        name: "delete_leaves",
        description: "删除指定子功能。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_module: z.string().describe("子模块名"),
          function: z.string().describe("功能名"),
          sub_functions: z
            .array(z.string())
            .describe("要删除的子功能名列表"),
        }),
      },
    ),

    tool(
      async ({
        module,
        sub_module,
        function: funcName,
        sub_function,
        new_description,
      }: {
        module: string;
        sub_module: string;
        function: string;
        sub_function: string;
        new_description: string;
      }) => {
        table.updateLeafDescription(
          module,
          sub_module,
          funcName,
          sub_function,
          new_description,
        );
        return JSON.stringify({
          success: true,
          text: `已更新子功能"${sub_function}"的描述。`,
        });
      },
      {
        name: "update_leaf_description",
        description: "修改一个子功能的描述文本。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_module: z.string().describe("子模块名"),
          function: z.string().describe("功能名"),
          sub_function: z.string().describe("子功能名"),
          new_description: z.string().describe("新的描述文本"),
        }),
      },
    ),

    tool(
      async ({
        module,
        sub_module,
        function: funcName,
        old_name,
        new_name,
      }: {
        module: string;
        sub_module: string;
        function: string;
        old_name: string;
        new_name: string;
      }) => {
        table.renameSubFunction(
          module,
          sub_module,
          funcName,
          old_name,
          new_name,
        );
        return JSON.stringify({
          success: true,
          text: `已将子功能"${old_name}"重命名为"${new_name}"。`,
        });
      },
      {
        name: "rename_sub_function",
        description: "重命名一个子功能。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_module: z.string().describe("子模块名"),
          function: z.string().describe("功能名"),
          old_name: z.string().describe("当前子功能名"),
          new_name: z.string().describe("新的子功能名"),
        }),
      },
    ),

    tool(
      async ({
        module,
        sub_module,
        function: funcName,
        sub_function,
      }: {
        module: string;
        sub_module: string;
        function: string;
        sub_function: string;
      }) => {
        table.markSubFunctionSupport(module, sub_module, funcName, sub_function);
        return JSON.stringify({
          success: true,
          text: `已将子功能"${module} → ${sub_module} → ${funcName} → ${sub_function}"标记为支撑域（非代码交付）。`,
        });
      },
      {
        name: "mark_sub_function_support",
        description:
          "标记一个子功能为支撑域（非代码交付范畴）。通常用于标记纯文档/设计类输出。",
        schema: z.object({
          module: z.string().describe("父模块名"),
          sub_module: z.string().describe("子模块名"),
          function: z.string().describe("功能名"),
          sub_function: z.string().describe("要标记为支撑域的子功能名"),
        }),
      },
    ),
  ];
}

// Re-export formatters for prompt builders
export { formatModuleList, formatLevelRows, formatSubModuleRows, formatFunctionRows };

// ---------------------------------------------------------------------------
// Tool-call logging middleware
// ---------------------------------------------------------------------------

function formatToolArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).map(([k, v]) => {
    const s = Array.isArray(v)
      ? `[${(v as unknown[]).length} items]: ${JSON.stringify(v)}`
      : typeof v === "string" && v.length > 200
        ? `"${v.slice(0, 200)}…"`
        : JSON.stringify(v);
    return `  ${k}: ${s}`;
  });
  return entries.length ? `\n${entries.join("\n")}` : "  (none)";
}

export function createDecomposerToolMiddleware(
  agentLabel: string,
  table: DecomposerTree,
  level: number,
  agentLogger: ReturnType<typeof log.child>,
) {
  let callN = 0;

  return createMiddleware({
    name: `ToolLogger_${agentLabel}`,
    wrapToolCall: async (request: any, handler: any) => {
      callN++;
      const toolName: string = request.toolCall.name;
      const args = (request.toolCall.args ?? {}) as Record<string, unknown>;
      const t0 = Date.now();

      agentLogger.info(`  ⚙ #${callN} ${toolName}${formatToolArgs(args)}`);

      const result = await handler(request);
      const dur = Date.now() - t0;

      agentLogger.info(
        `  ↳ #${callN} done (${dur}ms)\n` +
        table.formatTreeForLevel(level),
      );

      return result;
    },
  });
}
