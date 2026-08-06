"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Loader2, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ModelConfig } from "@/lib/session-config";
import { DEFAULT_MAX_TOKENS } from "@/lib/session-config";
import { usePresales } from "@/lib/presales-context";
import { generateId } from "@/lib/utils";

function generateModelId(): string {
  return "m-" + generateId().slice(0, 8);
}

interface ModelConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PresetDef {
  id: string;
  name: string;
  baseUrl: string;
  protocol: "openai" | "anthropic";
}

const PRESETS: PresetDef[] = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai" },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.chat/v1", protocol: "openai" },
  { id: "glm", name: "GLM (智谱)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", protocol: "openai" },
  { id: "gpt", name: "GPT (OpenAI)", baseUrl: "https://api.openai.com/v1", protocol: "openai" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", protocol: "anthropic" },
  { id: "custom", name: "自定义", baseUrl: "", protocol: "openai" },
];

interface ModelListState {
  fetching: boolean;
  models: string[];
  error: string;
}

function emptyListState(): ModelListState {
  return { fetching: false, models: [], error: "" };
}

export function ModelConfigDialog({ open, onOpenChange }: ModelConfigDialogProps) {
  const { customModels, setCustomModels } = usePresales();
  const [draft, setDraft] = useState<ModelConfig[]>([]);
  const [presetMap, setPresetMap] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<Record<string, ModelListState>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(customModels.map((m) => ({ ...m })));
      const pm: Record<string, string> = {};
      for (const m of customModels) {
        const found = PRESETS.find(
          (p) => p.id !== "custom" && m.baseUrl === p.baseUrl && m.protocol === p.protocol,
        );
        pm[m.id] = found?.id ?? "custom";
      }
      setPresetMap(pm);
      setModelList({});
    }
  }, [open, customModels]);

  function handleAdd() {
    const id = generateModelId();
    setDraft((prev) => [
      ...prev,
      { id, name: "", model: "", baseUrl: "", apiKey: "", protocol: "openai", maxTokens: DEFAULT_MAX_TOKENS },
    ]);
    setPresetMap((prev) => ({ ...prev, [id]: "custom" }));
  }

  function handleDelete(id: string) {
    setDraft((prev) => prev.filter((m) => m.id !== id));
    setPresetMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setModelList((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function handleChange(id: string, field: keyof ModelConfig, value: string) {
    setDraft((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        const updated = { ...m, [field]: value };
        if (field === "baseUrl" || field === "protocol") {
          setPresetMap((pm) => ({ ...pm, [id]: "custom" }));
        }
        return updated;
      }),
    );
  }

  function handlePresetChange(id: string, presetId: string) {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setPresetMap((prev) => ({ ...prev, [id]: presetId }));
    setDraft((prev) =>
      prev.map((m) =>
        m.id === id
          ? { ...m, name: preset.name, baseUrl: preset.baseUrl, protocol: preset.protocol }
          : m,
      ),
    );
    setModelList((prev) => ({ ...prev, [id]: emptyListState() }));
  }

  async function handleFetchModels(id: string) {
    const model = draft.find((m) => m.id === id);
    if (!model || !model.apiKey || !model.baseUrl) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setModelList((prev) => ({
      ...prev,
      [id]: { fetching: true, models: [], error: "" },
    }));

    try {
      const res = await fetch("/api/models/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          protocol: model.protocol,
        }),
        signal: controller.signal,
      });
      const data = await res.json();

      if (controller.signal.aborted) return;

      if (!res.ok || data.error) {
        setModelList((prev) => ({
          ...prev,
          [id]: { fetching: false, models: [], error: data.error || `请求失败 (${res.status})` },
        }));
        return;
      }

      setModelList((prev) => ({
        ...prev,
        [id]: { fetching: false, models: data.models || [], error: "" },
      }));
    } catch (err) {
      if (controller.signal.aborted) return;
      setModelList((prev) => ({
        ...prev,
        [id]: {
          fetching: false,
          models: [],
          error: err instanceof Error ? err.message : "获取失败",
        },
      }));
    }
  }

  function handleSave() {
    const valid = draft.filter((m) => m.name.trim() && m.model.trim());
    setCustomModels(valid);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>模型配置</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {draft.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              暂无配置模型，点击下方按钮添加
            </p>
          )}
          {draft.map((m) => {
            const currentPreset = presetMap[m.id] ?? "custom";
            const list = modelList[m.id] ?? emptyListState();

            return (
              <div key={m.id} className="border rounded-lg p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    模型 #{m.id.slice(-4)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleDelete(m.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <select
                  value={currentPreset}
                  onChange={(e) => handlePresetChange(m.id, e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 cursor-pointer"
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>

                <Input
                  placeholder="Base URL"
                  value={m.baseUrl}
                  onChange={(e) => handleChange(m.id, "baseUrl", e.target.value)}
                />

                <Input
                  type="password"
                  placeholder="API Key"
                  value={m.apiKey}
                  onChange={(e) => handleChange(m.id, "apiKey", e.target.value)}
                />

                <div className="flex items-center gap-1.5">
                  {list.models.length > 0 ? (
                    <select
                      value={m.model}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev.map((item) =>
                            item.id === m.id ? { ...item, model: e.target.value } : item,
                          ),
                        )
                      }
                      className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 cursor-pointer"
                    >
                      {list.models.map((mid) => (
                        <option key={mid} value={mid}>
                          {mid}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      placeholder="模型 ID"
                      value={m.model}
                      onChange={(e) => handleChange(m.id, "model", e.target.value)}
                    />
                  )}
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={!m.apiKey || !m.baseUrl || list.fetching}
                    onClick={() => handleFetchModels(m.id)}
                    title="获取模型列表"
                  >
                    {list.fetching ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                  </Button>
                </div>

                {list.error && (
                  <p className="text-xs text-destructive">{list.error}</p>
                )}

                <select
                  value={m.protocol}
                  onChange={(e) => handleChange(m.id, "protocol", e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 cursor-pointer"
                >
                  <option value="openai">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic</option>
                </select>

                <Input
                  type="number"
                  placeholder={`Max Tokens (默认 ${DEFAULT_MAX_TOKENS})`}
                  value={m.maxTokens ?? ""}
                  onChange={(e) =>
                    setDraft((prev) =>
                      prev.map((item) =>
                        item.id === m.id
                          ? { ...item, maxTokens: e.target.value ? Number(e.target.value) : DEFAULT_MAX_TOKENS }
                          : item,
                      ),
                    )
                  }
                />
              </div>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleAdd}
          >
            <Plus className="size-4 mr-1" />
            添加模型
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
