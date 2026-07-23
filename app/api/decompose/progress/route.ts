import { getDecomposerProgress } from "@/lib/agent/main-agent";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId") || "default";

  const progress = getDecomposerProgress(sessionId);

  return new Response(JSON.stringify({
    progress,
    active: progress !== null,
  }), {
    headers: { "Content-Type": "application/json" },
  });
}
