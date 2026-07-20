"use client";

import { Bot } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePresales } from "@/lib/presales-context";
import { AVAILABLE_MODELS } from "@/lib/constants";

export function ModelPicker() {
  const { modelProvider, setModelProvider } = usePresales();
  const current = AVAILABLE_MODELS.find((m) => m.id === modelProvider) ?? AVAILABLE_MODELS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer">
          <Bot className="size-4" />
          <span>{current.name}</span>
          <span className="text-xs opacity-60">{current.version}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {AVAILABLE_MODELS.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => setModelProvider(m.id)}
            className={m.id === modelProvider ? "bg-accent" : ""}
          >
            <span className="flex-1">{m.name}</span>
            <span className="text-xs text-muted-foreground">{m.version}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
