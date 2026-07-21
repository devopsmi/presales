"use client";

import { useState, useEffect } from "react";
import { Bot, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { usePresales } from "@/lib/presales-context";
import { ModelConfigDialog } from "./model-config-dialog";

export function ModelPicker() {
  const { modelProvider, setModelProvider, customModels } = usePresales();
  const [dialogOpen, setDialogOpen] = useState(false);

  const hasCustom = customModels.length > 0;

  // Auto-select first custom model if current selection doesn't match any
  useEffect(() => {
    if (hasCustom && !customModels.some((m) => m.id === modelProvider)) {
      setModelProvider(customModels[0].id);
    }
  }, [hasCustom, customModels, modelProvider, setModelProvider]);

  const current = customModels.find((m) => m.id === modelProvider);
  const displayName = current?.name ?? "配置模型";
  const currentProtocol = current?.protocol ?? "openai";

  const protocolLabel = (protocol: string) =>
    protocol === "anthropic" ? "Anthropic" : "OpenAI";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer">
            <Bot className="size-4" />
            <span>{displayName}</span>
            <span className="text-xs text-muted-foreground">({protocolLabel(currentProtocol)})</span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {hasCustom ? (
            customModels.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => setModelProvider(m.id)}
                className={m.id === modelProvider ? "bg-accent" : ""}
              >
                <span className="flex-1">{m.name}</span>
                <span className="text-xs text-muted-foreground">{protocolLabel(m.protocol)}</span>
              </DropdownMenuItem>
            ))
          ) : (
            <div className="px-2 py-3 text-xs text-muted-foreground text-center">
              暂无模型，请先配置
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialogOpen(true)}>
            <Settings className="size-4 mr-2" />
            <span>配置模型...</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ModelConfigDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
