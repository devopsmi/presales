import log from "@/lib/logger";

export const runtime = "nodejs";

interface ModelsListRequest {
  baseUrl: string;
  apiKey: string;
  protocol: "openai" | "anthropic";
}

export async function POST(req: Request) {
  const body = (await req.json()) as ModelsListRequest;

  if (!body.apiKey) {
    return Response.json({ error: "API Key 不能为空" }, { status: 400 });
  }

  try {
    if (body.protocol === "anthropic") {
      const url = `${body.baseUrl}/v1/models`;
      log.info("Fetching anthropic models", { url: url.replace(/\/\/[^@]+@/, "//***@") });

      const res = await fetch(url, {
        headers: {
          "x-api-key": body.apiKey,
          "anthropic-version": "2023-06-01",
        },
      });

      if (!res.ok) {
        const text = await res.text();
        return Response.json({ error: `Anthropic API error (${res.status}): ${text.slice(0, 200)}` }, { status: res.status });
      }

      const data = await res.json();
      const models: string[] = (data.data || []).map((m: { id: string }) => m.id);
      return Response.json({ models });
    }

    const url = `${body.baseUrl}/models`;
    log.info("Fetching openai models", { url: url.replace(/\/\/[^@]+@/, "//***@") });

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${body.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `API error (${res.status}): ${text.slice(0, 200)}` }, { status: res.status });
    }

    const data = await res.json();
    const models: string[] = (data.data || []).map((m: { id: string }) => m.id);
    return Response.json({ models });
  } catch (err) {
    log.error("Models list fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      { error: err instanceof Error ? err.message : "获取模型列表失败" },
      { status: 500 },
    );
  }
}
