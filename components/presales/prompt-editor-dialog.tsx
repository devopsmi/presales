"use client";

import { useState, useEffect } from "react";
import { FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { usePresales } from "@/lib/presales-context";
import {
  PROMPT_CATEGORIES,
  PROMPT_DEFS,
  getPromptsByCategory,
  getDefaultPrompt,
} from "@/lib/prompt-defaults";

interface PromptEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PromptEditorDialog({ open, onOpenChange }: PromptEditorDialogProps) {
  const { promptOverrides, setPromptOverrides } = usePresales();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState(PROMPT_CATEGORIES[0].key);

  useEffect(() => {
    if (open) {
      // Initialize draft from all default prompts, overridden by user-saved values
      const defaultsOnly: Record<string, string> = {};
      for (const def of PROMPT_DEFS) {
        defaultsOnly[def.key] = def.defaultContent;
      }
      setDraft({ ...defaultsOnly, ...promptOverrides });
    }
  }, [open, promptOverrides]);

  function handlePromptChange(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function handleRestoreDefault(key: string) {
    setDraft((prev) => ({ ...prev, [key]: getDefaultPrompt(key) }));
  }

  function handleSave() {
    // Only persist overrides that differ from defaults
    const realOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft)) {
      if (value.trim() && value !== getDefaultPrompt(key)) {
        realOverrides[key] = value;
      }
    }
    setPromptOverrides(realOverrides);
    onOpenChange(false);
  }

  const activePrompts = getPromptsByCategory(activeCategory);
  const activeCategoryTitle =
    PROMPT_CATEGORIES.find((c) => c.key === activeCategory)?.title ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            提示词管理
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left sidebar */}
          <div className="w-40 border-r flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
              <div className="p-2 space-y-1">
                {PROMPT_CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => setActiveCategory(cat.key)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      activeCategory === cat.key
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    {cat.title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right content */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-6 py-3 border-b bg-muted/30 shrink-0">
              <h3 className="font-medium text-sm">{activeCategoryTitle}</h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
              <div className="p-6 space-y-6">
                {activePrompts.map((prompt) => (
                    <div key={prompt.key} className="space-y-2">
                      <label className="text-sm font-medium">
                        {prompt.title}
                      </label>
                      <Textarea
                        value={draft[prompt.key] ?? ""}
                        onChange={(e) =>
                          handlePromptChange(prompt.key, e.target.value)
                        }
                        className="min-h-[120px] resize-y"
                      />
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestoreDefault(prompt.key)}
                        >
                          恢复默认
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
