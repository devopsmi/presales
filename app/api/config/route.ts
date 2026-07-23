import { updateSessionConfig } from "@/lib/session-config";
import type { ModelConfig } from "@/lib/session-config";
import type { TradeRole } from "@/lib/constants";
import type { QuotedRates } from "@/lib/types";
import log from "@/lib/logger";

export const runtime = "nodejs";

interface ConfigRequest {
  sessionId: string;
  trades?: TradeRole[];
  budgetRange?: [number, number];
  model?: string;
  models?: ModelConfig[];
  vendorName?: string;
  estimationPlanId?: string;
  quotedRates?: QuotedRates;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ConfigRequest;

    if (!body.sessionId || typeof body.sessionId !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid sessionId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const config = updateSessionConfig(body.sessionId, {
      trades: body.trades,
      budgetRange: body.budgetRange,
      model: body.model,
      models: body.models,
      vendorName: body.vendorName,
      estimationPlanId: body.estimationPlanId,
      quotedRates: body.quotedRates,
    });

    log.info("Session config updated", {
      sessionId: body.sessionId.slice(0, 8),
      trades: config.trades.length,
      model: config.model,
      modelsCount: config.models.length,
    });

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    log.error("Config API error", {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
