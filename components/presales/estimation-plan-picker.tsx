"use client";

import { Calculator } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePresales } from "@/lib/presales-context";
import { useState } from "react";

const PLANS = [
  { id: "expert-judgment-plan", label: "专家判断", desc: "全栈工程师经验直觉" },
  { id: "step-breakdown-plan", label: "步骤拆解", desc: "逐步骤计时汇总" },
  { id: "analogy-plan", label: "类比参照", desc: "对照典型功能模式" },
  { id: "pert-plan", label: "三点估算", desc: "乐观/可能/悲观加权" },
] as const;

const LABEL_MAP: Record<string, string> = Object.fromEntries(
  PLANS.map((p) => [p.id, p.label]),
);

export function EstimationPlanPicker() {
  const { estimationPlanId, setEstimationPlanId } = usePresales();
  const [open, setOpen] = useState(false);

  const currentLabel = LABEL_MAP[estimationPlanId];
  function handleSelect(planId: string) {
    setEstimationPlanId(planId);
    setOpen(false);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger>
        <button className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <Calculator className="size-4" />
          <span>工时估算</span>
          <span className="text-xs">({currentLabel})</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        {PLANS.map((plan) => (
          <DropdownMenuItem
            key={plan.id}
            onClick={() => handleSelect(plan.id)}
            className="flex flex-col items-start"
          >
            <span className={estimationPlanId === plan.id ? "font-medium" : ""}>
              {plan.label}
            </span>
            <span className="text-xs text-muted-foreground">{plan.desc}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
