"use client";

import { useState, useEffect, useCallback } from "react";
import { Coins } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { usePresales } from "@/lib/presales-context";

function formatAmount(v: number): string {
  if (v >= 10000) {
    const wan = v / 10000;
    return `${wan % 1 === 0 ? wan : wan.toFixed(1)}万`;
  }
  return v.toLocaleString();
}

export function BudgetInput() {
  const { budgetRange, setBudgetRange } = usePresales();
  const [min, max] = budgetRange;

  const initialPrice = Math.round((min + max) / 2);
  const initialDeviation = max - initialPrice;
  const isDefault = min === 0 && max === 2000000;

  const [priceStr, setPriceStr] = useState(() => String(initialPrice));
  const [deviationStr, setDeviationStr] = useState(() => String(initialDeviation));
  const [open, setOpen] = useState(false);

  // Sync from external budgetRange changes (e.g. reset, industry switch)
  useEffect(() => {
    const p = Math.round((min + max) / 2);
    const d = max - p;
    setPriceStr(String(p));
    setDeviationStr(String(d));
  }, [min, max]);

  const commit = useCallback(() => {
    const p = Number(priceStr);
    const d = Number(deviationStr);
    if (isNaN(p) || isNaN(d) || d < 0) return;
    const newMin = Math.max(0, p - d);
    const newMax = p + d;
    setBudgetRange([newMin, newMax]);
  }, [priceStr, deviationStr, setBudgetRange]);

  function handleConfirm() {
    commit();
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleConfirm();
    }
  }

  function handleOpenChange(o: boolean) {
    if (o) {
      const p = Math.round((min + max) / 2);
      const d = max - p;
      setPriceStr(String(p));
      setDeviationStr(String(d));
    } else {
      // Closed without confirming — revert to committed values
      const p = Math.round((min + max) / 2);
      const d = max - p;
      setPriceStr(String(p));
      setDeviationStr(String(d));
    }
    setOpen(o);
  }

  const p = Number(priceStr);
  const d = Number(deviationStr);
  const labelSuffix =
    isDefault || isNaN(p) || isNaN(d)
      ? ""
      : ` ${formatAmount(p)}±${formatAmount(d)}`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger>
        <button className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <Coins className="size-4" />
          <span>预算</span>
          {labelSuffix && (
            <span className="text-xs">{labelSuffix}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        {/* stopPropagation prevents InputBar's container onClick from stealing focus */}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="number"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-24 h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm text-center outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="价格"
          />
          <span className="text-sm text-muted-foreground select-none">±</span>
          <input
            type="number"
            value={deviationStr}
            onChange={(e) => setDeviationStr(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-20 h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm text-center outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="偏差"
          />
          <Button size="sm" onClick={handleConfirm} className="ml-1">
            确定
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
