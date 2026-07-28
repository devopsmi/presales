"use client";

import { Wrench } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { usePresales } from "@/lib/presales-context";
import { TRADES, TRADE_DAILY_RATES, type TradeRole } from "@/lib/constants";
import type { QuotedRates } from "@/lib/types";
import { useState, useCallback } from "react";

export function TradeSelector() {
  const { selectedTrades, quotedRates, setSelectedTrades, setQuotedRates } = usePresales();
  const [open, setOpen] = useState(false);
  const [tempTrades, setTempTrades] = useState<TradeRole[]>(selectedTrades);
  const [tempRates, setTempRates] = useState<QuotedRates>(quotedRates);

  function toggleTrade(role: TradeRole) {
    setTempTrades((prev) => {
      if (prev.includes(role)) {
        if (prev.length <= 1) return prev;
        return prev.filter((t) => t !== role);
      }
      // Initialize rate from default when newly selected
      setTempRates((prev) => {
        if (prev[role] !== undefined) return prev;
        return { ...prev, [role]: TRADE_DAILY_RATES[role] };
      });
      return [...prev, role];
    });
  }

  const handleRateChange = useCallback((role: TradeRole, raw: string) => {
    const val = parseInt(raw, 10);
    setTempRates((prev) => ({
      ...prev,
      [role]: isNaN(val) || val < 0 ? undefined : val,
    }));
  }, []);

  function handleConfirm() {
    setSelectedTrades(tempTrades);
    // Only keep rates for selected trades
    const cleaned: QuotedRates = {};
    for (const t of tempTrades) {
      const rate = tempRates[t];
      cleaned[t] = rate !== undefined && rate > 0 ? rate : TRADE_DAILY_RATES[t];
    }
    setQuotedRates(cleaned);
    setOpen(false);
  }

  function handleReset() {
    setTempTrades(TRADES.map((t) => t.id));
    setTempRates({ ...TRADE_DAILY_RATES });
  }

  const count = selectedTrades.length;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setTempTrades([...selectedTrades]); setTempRates({ ...quotedRates }); } }}>
      <PopoverTrigger>
        <button className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <Wrench className="size-4" />
          <span>参与工种</span>
          {count > 0 && <span className="text-xs">({count})</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="px-3 pt-3 pb-1">
          <p className="text-sm font-medium mb-2">选择工种与报价单价</p>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {TRADES.map((trade) => {
              const checked = tempTrades.includes(trade.id);
              const rate = tempRates[trade.id];
              return (
                <label key={trade.id} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-accent rounded px-1">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleTrade(trade.id)}
                  />
                  <span className="text-sm w-20 shrink-0">{trade.label}</span>
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    <span className="text-xs text-muted-foreground shrink-0">¥</span>
                    <Input
                      className="h-7 w-20 text-xs px-1.5"
                      value={checked && rate !== undefined ? String(rate) : ""}
                      disabled={!checked}
                      onChange={(e) => handleRateChange(trade.id, e.target.value)}
                      placeholder={checked ? String(TRADE_DAILY_RATES[trade.id]) : undefined}
                      onBlur={() => {
                        if (checked && (!tempRates[trade.id] || tempRates[trade.id]! <= 0)) {
                          setTempRates((prev) => ({ ...prev, [trade.id]: TRADE_DAILY_RATES[trade.id] }));
                        }
                      }}
                    />
                    <span className="text-[10px] text-muted-foreground shrink-0">/人天</span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
        <Separator />
        <div className="flex items-center justify-between p-3 pt-2">
          <Button variant="ghost" size="sm" onClick={handleReset}>重置</Button>
          <Button size="sm" onClick={handleConfirm}>确定({tempTrades.length})</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
