export const runtime = "nodejs";

export async function POST(_req: Request) {
  return new Response(
    JSON.stringify({ error: "Agent 模块重构中，暂不可用" }),
    {
      status: 503,
      headers: { "Content-Type": "application/json" },
    },
  );
}
