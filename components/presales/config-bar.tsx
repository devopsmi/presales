"use client";

import { FileUploadMenu } from "./file-upload-menu";
import { TradeSelector } from "./trade-selector";
import { BudgetSlider } from "./budget-slider";
import { ModelPicker } from "./model-picker";
import { Separator } from "@/components/ui/separator";

export function ConfigBar() {
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-t bg-muted/30 flex-wrap">
      <FileUploadMenu />
      <Separator orientation="vertical" className="h-5" />
      <TradeSelector />
      <Separator orientation="vertical" className="h-5" />
      <BudgetSlider />
      <Separator orientation="vertical" className="h-5" />
      <ModelPicker />
    </div>
  );
}
