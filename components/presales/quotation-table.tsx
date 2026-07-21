"use client";

import type { QuotationRow } from "@/lib/types";
import type { TradeRole } from "@/lib/constants";
import { TRADE_LABELS } from "@/lib/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface QuotationTableProps {
  rows: QuotationRow[];
  trades: TradeRole[];
}

export function QuotationTable({ rows, trades }: QuotationTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        暂无报价数据
      </div>
    );
  }

  // Compute rowSpans for mergeable columns
  const spans = computeSpans(rows);

  // Build column headers
  const fixedHeaders = ["序号", "模块", "子模块", "功能", "子功能", "功能描述"];
  const tradeHeaders = trades.map((t) => TRADE_LABELS[t]);

  return (
    <div className="overflow-x-auto">
      <Table className=" scrollbar-none">
        <TableHeader>
          <TableRow>
            {fixedHeaders.map((h, i) => (
              <TableHead key={h} className={i === 0 ? "w-[60px]" : i === 5 ? "min-w-[200px]" : ""}>
                {h}
              </TableHead>
            ))}
            {tradeHeaders.map((h) => (
              <TableHead key={h} className="text-center w-[80px]">{h}</TableHead>
            ))}
            <TableHead className="w-[120px]">备注</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, idx) => {
            const span = spans[idx];
            if (!span) return null; // Cell hidden by rowSpan

            return (
              <TableRow key={row.seq}>
                <TableCell className="text-center">{row.seq}</TableCell>
                {span.module > 0 && (
                  <TableCell rowSpan={span.module} className="align-middle bg-muted/30">
                    {row.module}
                  </TableCell>
                )}
                {span.sub_module > 0 && (
                  <TableCell rowSpan={span.sub_module} className="align-middle">
                    {row.sub_module}
                  </TableCell>
                )}
                {span.function > 0 && (
                  <TableCell rowSpan={span.function} className="align-middle bg-muted/10">
                    {row.function}
                  </TableCell>
                )}
                {span.sub_function > 0 && (
                  <TableCell rowSpan={span.sub_function} className="align-middle">
                    {row.sub_function}
                  </TableCell>
                )}
                <TableCell className="text-sm max-w-[300px] truncate" title={row.description}>
                  {row.description}
                </TableCell>
                {trades.map((t) => {
                  const val = row.trades[t];
                  const display = val === null || val === undefined ? "-" : String(val);
                  return (
                    <TableCell key={t} className="text-center text-sm">
                      {display}
                    </TableCell>
                  );
                })}
                <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">
                  {row.remark || "-"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

interface RowSpan {
  module: number;
  sub_module: number;
  function: number;
  sub_function: number;
}

function computeSpans(rows: QuotationRow[]): (RowSpan | null)[] {
  const result: (RowSpan | null)[] = new Array(rows.length).fill(null);
  const fields = ["module", "sub_module", "function", "sub_function"] as const;

  for (const field of fields) {
    let start = 0;
    for (let i = 1; i <= rows.length; i++) {
      const groupEnd = i === rows.length || rows[i][field] !== rows[start][field];
      if (groupEnd) {
        const count = i - start;
        if (!result[start]) {
          result[start] = { module: 0, sub_module: 0, function: 0, sub_function: 0 };
        }
        (result[start] as RowSpan)[field] = count;
        start = i;
      }
    }
  }

  return result;
}
