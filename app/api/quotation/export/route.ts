import { type NextRequest, NextResponse } from "next/server";
import { generateQuotationXlsx } from "@/lib/agent/tools/xlsx-generator";
import type { QuotationRow, QuotationHeader } from "@/lib/agent/state";
import type { TradeRole } from "@/lib/constants";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rows: QuotationRow[] = body.rows ?? [];
    const header: QuotationHeader = body.header ?? {};
    const trades: TradeRole[] = body.trades ?? [];

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
    console.error("Export error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}
