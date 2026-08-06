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
import { DEFAULT_MAX_TOKENS } from "@/lib/session-config";
import log from "@/lib/logger";

const llmLog = log.child({ module: "llm" });

const PREVIEW_LEN = 100000;

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

type ContentBlock = { type: string; text?: string; reasoning?: string; thinking?: string; [k: string]: unknown };

export function extractStringContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const blocks = content as ContentBlock[];
    // Primary: extract text blocks
    const text = blocks
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("");
    if (text) return text;
    // Fallback: when models like deepseek-v4-pro return only reasoning blocks
    // (no text blocks), extract from reasoning content instead.
    const reasoning = blocks
      .filter((b) => b.type === "reasoning" && b.reasoning)
      .map((b) => b.reasoning!)
      .join("\n");
    if (reasoning) return reasoning;
    return "";
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
  const end = c.indexOf("\n");
  if (end === -1) return c;
  return `${c.slice(0, end)}… (${c.length} chars)`;
}

function dur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Preserve deepseek thinking blocks across multi-turn agent calls.
 *
 * DeepSeek in thinking mode returns content arrays like:
 *   [{"type":"thinking","thinking":"..."}, {"type":"text","text":"..."}]
 * ChatOpenAI may drop unknown block types when re-serializing for the next
 * request. This middleware captures them from the response and restores them
 * in subsequent requests so DeepSeek doesn't reject with 400.
 */
/**
 * Storage key for persisting deepseek thinking blocks.
 *
 * We store thinking blocks in `additional_kwargs` (a standard AIMessage field
 * preserved through LangGraph serialization) rather than a Symbol property
 * (which is silently dropped when messages are checkpointed/restored).
 */
const THINKING_KWARGS_KEY = "deepseek_thinking";

function extractThinkingBlocks(content: unknown): ContentBlock[] | null {
  if (!Array.isArray(content)) return null;
  const thinking = content.filter((b: any) => b.type === "thinking" && b.thinking);
  return thinking.length > 0 ? thinking : null;
}

function restoreThinkingBlocks(msg: Record<string, unknown>): void {
  const additionalKwargs = (msg as any).additional_kwargs as Record<string, unknown> | undefined;
  const blocks = additionalKwargs?.[THINKING_KWARGS_KEY] as ContentBlock[] | undefined;
  if (!blocks?.length) return;

  const content = msg.content;
  if (typeof content === "string") {
    msg.content = [...blocks, { type: "text", text: content }];
  } else if (Array.isArray(content)) {
    const hasThinking = (content as ContentBlock[]).some((b: any) => b.type === "thinking");
    if (!hasThinking) {
      msg.content = [...blocks, ...(content as ContentBlock[])];
    }
  }
}

export function createDeepseekThinkingMiddleware() {
  return createMiddleware({
    name: "DeepseekThinkingRepair",
    wrapModelCall: async (request: any, handler: any) => {
      // PRE: restore thinking blocks from additional_kwargs (survives serialization)
      if (request.messages) {
        for (const msg of request.messages) {
          if (typeof msg._getType === "function" && msg._getType() !== "ai") continue;
          restoreThinkingBlocks(msg);
        }
      }

      const response = await handler(request);

      // POST: capture thinking blocks into additional_kwargs —
      //       AIMessage.additional_kwargs survives LangGraph state
      //       checkpoint/restore, unlike Symbol-keyed properties.
      const content = response.content;
      const thinking = extractThinkingBlocks(content);
      if (thinking) {
        response.additional_kwargs = {
          ...(response.additional_kwargs || {}),
          [THINKING_KWARGS_KEY]: thinking,
        };
      }

      return response;
    },
  });
}

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
        const end = sysContent.indexOf("\n");
        llmLog.debug("  sys", {
          agent: agentName,
          preview: end === -1 ? sysContent : `${sysContent.slice(0, end)}… (${sysContent.length} chars)`,
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

  // Only override maxTokens when a custom model is configured.
  // For standard env-based providers, let the API use its own defaults.
  const maxTokens: number | undefined = cfg
    ? (cfg.maxTokens ?? DEFAULT_MAX_TOKENS)
    : undefined;

  // Custom endpoint with Anthropic protocol → ChatAnthropic
  if (cfg?.baseUrl && (cfg.protocol === "anthropic" || defaultProvider === "anthropic")) {
    return new ChatAnthropic({
      model: modelName,
      apiKey: cfg.apiKey || process.env.ANTHROPIC_API_KEY,
      clientOptions: { baseURL: cfg.baseUrl },
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
  }

  // Custom endpoint with OpenAI protocol → ChatOpenAI
  if (cfg?.baseUrl) {
    return new ChatOpenAI({
      model: modelName,
      configuration: {
        baseURL: cfg.baseUrl,
        apiKey: cfg.apiKey || process.env.OPENAI_API_KEY,
      },
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
  }

  // Standard providers (no custom endpoint)
  if (cfg?.protocol === "anthropic" || defaultProvider === "anthropic") {
    return new ChatAnthropic({
      model: modelName,
      ...(cfg?.apiKey ? { apiKey: cfg.apiKey } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
  }

  return new ChatOpenAI({
    model: modelName,
    ...(cfg?.apiKey ? { configuration: { apiKey: cfg.apiKey } } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  });
}
