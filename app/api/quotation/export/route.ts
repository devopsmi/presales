import { type NextRequest, NextResponse } from "next/server";
import { generateQuotationXlsx } from "@/lib/xlsx-generator";
import type { QuotationRow, QuotationHeader } from "@/lib/types";
import type { TradeRole } from "@/lib/constants";
import log from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows: QuotationRow[] = body.rows ?? [];
    const header: QuotationHeader = body.header ?? {};
    const trades: TradeRole[] = body.trades ?? [];
    log.info("Export request received", { rowCount: rows.length });

    if (!rows.length) {
      return NextResponse.json({ error: "No rows provided" }, { status: 400 });
    }

    const buffer = await generateQuotationXlsx(rows, trades, header);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="quotation.xlsx"`,
      },
    });
  } catch (err) {
    log.error("Export error", {error: err instanceof Error ? err : new Error(String(err))});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}
