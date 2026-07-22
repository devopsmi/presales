/**
 * LLM model factory — creates LangChain-compatible model instances.
 *
 * Model configuration flows from frontend (ModelPicker) → session-config → here.
 * Falls back to env vars when no custom model is configured.
 */
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { createMiddleware } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ModelConfig } from "@/lib/session-config";
import log from "@/lib/logger";

const llmLog = log.child({ module: "llm" });

const PREVIEW_LEN = 400;

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

type ContentBlock = { type: string; text?: string; reasoning?: string; [k: string]: unknown };

export function extractStringContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as ContentBlock[])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("");
  }
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c.text === "string") return c.text;
    if (typeof c.content === "string") return c.content;
  }
  return "";
}

function extractReasoning(content: unknown): string {
  if (Array.isArray(content)) {
    return (content as ContentBlock[])
      .filter((b) => b.type === "reasoning" && b.reasoning)
      .map((b) => b.reasoning!)
      .join("\n");
  }
  return "";
}

function getSystemContent(request: Record<string, unknown>): string {
  const sysMsg = request.systemMessage as Record<string, unknown> | undefined;
  if (!sysMsg) return "";
  const c = sysMsg.content as unknown;
  return extractStringContent(c);
}

function getResponseContent(response: unknown): { text: string; reasoning: string } {
  if (typeof response === "string") return { text: response, reasoning: "" };
  const r = response as Record<string, unknown>;
  const content = r.content;
  return {
    text: extractStringContent(content),
    reasoning: extractReasoning(content),
  };
}

function getModelName(model: unknown): string {
  const m = model as Record<string, unknown>;
  return (m.model as string) ?? (m.modelName as string) ?? "unknown";
}

function getMsgRole(msg: Record<string, unknown>): string {
  if (typeof msg._getType === "function") return (msg._getType as () => string)();
  if (typeof msg.type === "string") return msg.type;
  return "unknown";
}

function getMsgPreview(msg: Record<string, unknown>): string {
  const c = extractStringContent(msg.content);
  if (!c) {
    const r = extractReasoning(msg.content);
    if (r) return `[reasoning ${r.length} chars]`;
    return "[empty]";
  }
  return c.length > PREVIEW_LEN ? c.slice(0, PREVIEW_LEN) + "…" : c;
}

function dur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function createModelLoggingMiddleware(agentName: string) {
  return createMiddleware({
    name: `ModelLogger_${agentName}`,
    wrapModelCall: async (request: any, handler: any) => {
      const messages = request.messages as Array<Record<string, unknown>>;
      const sysContent = getSystemContent(request);
      const modelName = getModelName(request.model);

      // --- INPUT ---
      llmLog.info("▶ llm", {
        agent: agentName,
        model: modelName,
        msgs: messages?.length ?? 0,
        sys: sysContent.length,
        input: (messages?.length ?? 0) > 0
          ? getMsgPreview(messages[messages!.length - 1])
          : "",
      });

      if (sysContent) {
        llmLog.debug("  sys", {
          agent: agentName,
          preview: sysContent.length > PREVIEW_LEN ? sysContent.slice(0, PREVIEW_LEN) + "…" : sysContent,
        });
      }

      const t0 = Date.now();
      const response = await handler(request);
      const durationMs = Date.now() - t0;

      // --- OUTPUT ---
      const { text, reasoning } = getResponseContent(response);

      llmLog.info("◀ llm", {
        agent: agentName,
        model: modelName,
        dur: dur(durationMs),
        text: text.length,
        think: reasoning.length,
      });

      if (reasoning) {
        llmLog.debug("  think", {
          agent: agentName,
          preview: reasoning.length > PREVIEW_LEN ? reasoning.slice(0, PREVIEW_LEN) + "…" : reasoning,
        });
      }
      if (text) {
        llmLog.debug("  text", {
          agent: agentName,
          preview: text.length > PREVIEW_LEN ? text.slice(0, PREVIEW_LEN) + "…" : text,
        });
      }

      return response;
    },
  });
}

// ---------------------------------------------------------------------------
// Model factory
// ---------------------------------------------------------------------------

export function createModelInstance(
  cfg?: ModelConfig,
  defaultProvider: "openai" | "anthropic" = "openai",
): BaseChatModel {
  const modelName = cfg?.model
    || (defaultProvider === "anthropic"
      ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"
      : process.env.OPENAI_MODEL || "gpt-4o-mini");

  // Custom endpoint with Anthropic protocol → ChatAnthropic
  if (cfg?.baseUrl && (cfg.protocol === "anthropic" || defaultProvider === "anthropic")) {
    return new ChatAnthropic({
      model: modelName,
      maxTokens: 4096,
      apiKey: cfg.apiKey || process.env.ANTHROPIC_API_KEY,
      clientOptions: { baseURL: cfg.baseUrl },
    });
  }

  // Custom endpoint with OpenAI protocol → ChatOpenAI
  if (cfg?.baseUrl) {
    return new ChatOpenAI({
      model: modelName,
      maxTokens: 4096,
      configuration: {
        baseURL: cfg.baseUrl,
        apiKey: cfg.apiKey || process.env.OPENAI_API_KEY,
      },
    });
  }

  // Standard providers (no custom endpoint)
  if (cfg?.protocol === "anthropic" || defaultProvider === "anthropic") {
    return new ChatAnthropic({
      model: modelName,
      maxTokens: 4096,
      ...(cfg?.apiKey ? { apiKey: cfg.apiKey } : {}),
    });
  }

  return new ChatOpenAI({
    model: modelName,
    maxTokens: 4096,
    ...(cfg?.apiKey ? { configuration: { apiKey: cfg.apiKey } } : {}),
  });
}
