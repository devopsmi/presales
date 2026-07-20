"use client";

import { Coins } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { usePresales } from "@/lib/presales-context";

function formatBudget(value: number): string {
  if (value >= 10000) {
    const wan = value / 10000;
    if (wan >= 100) return `${Math.round(wan / 100) * 100}万`;
    return `${wan}万`;
  }
  return `${value}`;
}

export function BudgetSlider() {
  const { budgetRange, setBudgetRange } = usePresales();
  const [min, max] = budgetRange;

  const label = `${formatBudget(min)} - ${formatBudget(max)}`;

  return (
    <div className="inline-flex items-center gap-2">
      <Coins className="size-4 text-muted-foreground shrink-0" />
      <span className="text-sm text-muted-foreground whitespace-nowrap">预算</span>
      <div className="flex items-center gap-4 min-w-[180px]">
        <div className="flex-1 space-y-1">
          <Slider
            value={[min]}
            min={0}
            max={2000000}
            step={10000}
            onValueChange={(val) => {
              const v = Array.isArray(val) ? val[0] : val;
              setBudgetRange([Math.min(v ?? min, max - 10000), max]);
            }}
            className="h-4"
          />
          <Slider
            value={[max]}
            min={0}
            max={2000000}
            step={10000}
            onValueChange={(val) => {
              const v = Array.isArray(val) ? val[0] : val;
              setBudgetRange([min, Math.max(v ?? max, min + 10000)]);
            }}
            className="h-4"
          />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap w-24 text-right">{label}</span>
      </div>
    </div>
  );
}
