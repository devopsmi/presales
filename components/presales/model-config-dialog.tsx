"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ModelConfig } from "@/lib/session-config";
import { DEFAULT_MAX_TOKENS } from "@/lib/session-config";
import { usePresales } from "@/lib/presales-context";

function generateId(): string {
  return "m-" + crypto.randomUUID().slice(0, 8);
}

interface ModelConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ModelConfigDialog({ open, onOpenChange }: ModelConfigDialogProps) {
  const { customModels, setCustomModels } = usePresales();
  const [draft, setDraft] = useState<ModelConfig[]>([]);

  useEffect(() => {
    if (open) {
      setDraft(customModels.map((m) => ({ ...m })));
    }
  }, [open, customModels]);

  function handleAdd() {
    setDraft((prev) => [
      ...prev,
      { id: generateId(), name: "", model: "", baseUrl: "", apiKey: "", protocol: "openai", maxTokens: DEFAULT_MAX_TOKENS },
    ]);
  }

  function handleDelete(id: string) {
    setDraft((prev) => prev.filter((m) => m.id !== id));
  }

  function handleChange(id: string, field: keyof ModelConfig, value: string) {
    setDraft((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
    );
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
          {draft.map((m) => (
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
              <Input
                placeholder="名称（如 DeepSeek V3）"
                value={m.name}
                onChange={(e) => handleChange(m.id, "name", e.target.value)}
              />
              <Input
                placeholder="模型 ID（如 deepseek-chat）"
                value={m.model}
                onChange={(e) => handleChange(m.id, "model", e.target.value)}
              />
              <Input
                placeholder="Base URL（如 https://api.deepseek.com/v1）"
                value={m.baseUrl}
                onChange={(e) => handleChange(m.id, "baseUrl", e.target.value)}
              />
              <Input
                type="password"
                placeholder="API Key"
                value={m.apiKey}
                onChange={(e) => handleChange(m.id, "apiKey", e.target.value)}
              />
              <select
                value={m.protocol}
                onChange={(e) => handleChange(m.id, "protocol", e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
          ))}
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
