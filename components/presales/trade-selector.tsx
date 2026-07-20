"use client";

import { Wrench } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { usePresales } from "@/lib/presales-context";
import { INDUSTRIES, TRADES, INDUSTRY_DEFAULTS, type TradeRole, type Industry } from "@/lib/constants";
import { useState } from "react";

export function TradeSelector() {
  const { selectedTrades, industry, setSelectedTrades, setIndustry } = usePresales();
  const [open, setOpen] = useState(false);
  const [tempTrades, setTempTrades] = useState<TradeRole[]>(selectedTrades);

  function handleIndustryChange(ind: string) {
    setIndustry(ind as Industry);
    setTempTrades([...INDUSTRY_DEFAULTS[ind as Industry]]);
  }

  function toggleTrade(role: TradeRole) {
    setTempTrades((prev) => {
      if (prev.includes(role)) {
        if (prev.length <= 1) return prev;
        return prev.filter((t) => t !== role);
      }
      return [...prev, role];
    });
  }

  function handleConfirm() {
    setSelectedTrades(tempTrades);
    setOpen(false);
  }

  function handleReset() {
    setTempTrades([...INDUSTRY_DEFAULTS[industry]]);
  }

  const count = selectedTrades.length;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setTempTrades([...selectedTrades]); }}>
      <PopoverTrigger>
        <button className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <Wrench className="size-4" />
          <span>参与工种</span>
          {count > 0 && <span className="text-xs">({count})</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3 pb-0">
          <p className="text-sm font-medium mb-2">选择行业</p>
          <Tabs value={industry} onValueChange={handleIndustryChange}>
            <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-transparent">
              {INDUSTRIES.map((ind) => (
                <TabsTrigger key={ind} value={ind} className="text-xs px-2 py-1 h-7">
                  {ind}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <Separator className="my-2" />
        <div className="px-3 pb-1">
          <p className="text-sm font-medium mb-2">选择工种</p>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {TRADES.map((trade) => (
              <label key={trade.id} className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-accent rounded px-1">
                <Checkbox
                  checked={tempTrades.includes(trade.id)}
                  onCheckedChange={() => toggleTrade(trade.id)}
                />
                <span className="text-sm flex-1">{trade.label}</span>
                <span className="text-xs text-muted-foreground">
                  ¥{trade.dailyRate.toLocaleString()}/人天
                </span>
              </label>
            ))}
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
