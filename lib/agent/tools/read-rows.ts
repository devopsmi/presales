/**
 * Shared read_rows tool — query QuotationRow[] by module or sub_module.
 *
 * Used by:
 *  - Main agent's read_rows tool (session-scoped rows from PipelineCache)
 *  - Evaluator sub-agent (reads rows incrementally from decomposer output)
 *
 * Design: pure factory function that takes rows as a closure parameter,
 * making it reusable without depending on session cache internals.
 */
import { tool } from "langchain";
import { z } from "zod";
import type { QuotationRow } from "@/lib/types";

/**
 * Build a read_rows tool bound to a specific rows array.
 *
 * The tool supports filtering by module name, sub_module name,
 * or any combination. It returns a compact text representation of
 * matching rows suitable for LLM consumption, using the stable
 * hierarchy path (module→sub_module→function→sub_function) as
 * the row identifier.
 *
 * @param rows - The quotation rows to query (typically from decomposer output)
 * @returns A LangChain tool function
 */
export function buildReadRowsTool(rows: QuotationRow[]) {
  return tool(
    async ({ module, sub_module }: {
      module?: string;
      sub_module?: string;
    }): Promise<string> => {
      if (!rows.length) {
        return JSON.stringify({
          status: "ok",
          rows: [],
          totalRows: 0,
          message: "报价清单为空。",
        });
      }

      let filtered = rows;

      if (module) {
        filtered = filtered.filter(r => r.module === module);
      }
      if (sub_module) {
        filtered = filtered.filter(r => r.sub_module === sub_module);
      }

      // Detect "overview" mode — no filter params → show only hierarchy, omit descriptions
      const isOverview = !module && !sub_module;

      const lines = filtered.map(r => {
        const isSupport = r.function === r.sub_function;
        const prefix = `[${isSupport ? "设计" : "功能"}] ${r.module}` +
          ` → ${r.sub_module} → ${r.function}` +
          (r.sub_function ? ` → ${r.sub_function}` : "");
        if (isOverview) return prefix;
        return prefix + `: ${r.description}` + (r.remark ? ` (备注: ${r.remark})` : "");
      });

      return JSON.stringify({
        status: "ok",
        matched: filtered.length,
        totalRows: rows.length,
        rows: lines,
        ...(isOverview && { note: "概览模式已省略功能描述，按模块名/子模块名筛选后会显示完整信息。" }),
      });
    },
    {
      name: "read_rows",
      description:
        "按条件分页读取报价功能清单的指定行。支持通过模块名(module)、子模块名(sub_module)组合筛选。" +
        "用于分批次查阅报价数据，避免一次性读取全部行。" +
        "通常先不传任何参数查看概况，然后按模块逐批深入检查。",
      schema: z.object({
        module: z.string().optional()
          .describe("按模块名筛选，如 'C端微信小程序'"),
        sub_module: z.string().optional()
          .describe("按子模块名筛选，如 '订单管理'。可配合 module 参数精确过滤同名子模块"),
      }),
    },
  );
}
