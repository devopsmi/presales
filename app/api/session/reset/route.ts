import { clearSessionCache } from "@/lib/agent/main-agent";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId: string | undefined = body.sessionId;
    if (!sessionId || typeof sessionId !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid sessionId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    clearSessionCache(sessionId);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
