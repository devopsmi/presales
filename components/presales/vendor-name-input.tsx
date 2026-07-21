"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { usePresales } from "@/lib/presales-context";

export function VendorNameInput() {
  const { vendorName, setVendorName } = usePresales();
  const [value, setValue] = useState(() => vendorName);
  const [open, setOpen] = useState(false);

  function handleConfirm() {
    setVendorName(value);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleConfirm();
    }
  }

  function handleOpenChange(o: boolean) {
    if (o) {
      setValue(vendorName);
    }
    setOpen(o);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger>
        <button className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <Building2 className="size-4" />
          <span>报价单位</span>
          {vendorName && (
            <span className="text-xs max-w-[120px] truncate">{vendorName}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <label className="text-sm text-muted-foreground whitespace-nowrap">报价单位名称</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-64 h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            placeholder="请输入报价单位名称"
          />
          <Button size="sm" onClick={handleConfirm}>
            确定
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
