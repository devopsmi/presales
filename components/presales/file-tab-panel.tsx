"use client";

import { ResultPanel } from "./result-panel";
import { FileTabContent } from "./file-tab-content";
import { usePresales } from "@/lib/presales-context";
import { X, FileText, LayoutList } from "lucide-react";
import { cn } from "@/lib/utils";

function TabBar() {
  const {
    fileTabs,
    activeRightTab,
    setActiveRightTab,
    closeFileTab,
  } = usePresales();

  return (
    <div className="flex items-center border-b bg-background overflow-x-auto shrink-0 scrollbar-none">
      <button
        onClick={() => setActiveRightTab("quotation")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 text-sm shrink-0 border-b-2 transition-colors",
          activeRightTab === "quotation"
            ? "border-primary text-foreground font-medium"
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50",
        )}
      >
        <LayoutList className="size-3.5" />
        <span>报价结果</span>
      </button>

      {fileTabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "group flex items-center gap-1.5 px-3 py-2 text-sm shrink-0 border-b-2 transition-colors",
            activeRightTab === tab.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50",
          )}
        >
          <button
            onClick={() => setActiveRightTab(tab.id)}
            className="flex items-center gap-1.5 min-w-0"
          >
            <FileText className="size-3.5 shrink-0" />
            <span className="truncate max-w-[120px]">{tab.name}</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeFileTab(tab.id);
            }}
            className="shrink-0 size-4 rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function TabContent() {
  const { activeRightTab, fileTabs } = usePresales();

  if (activeRightTab === "quotation") {
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        <ResultPanel />
      </div>
    );
  }

  const activeFileTab = fileTabs.find((t) => t.id === activeRightTab);
  if (!activeFileTab) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        <ResultPanel />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <FileTabContent tab={activeFileTab} />
    </div>
  );
}

export function FileTabPanel() {
  return (
    <div className="flex flex-col h-full">
      <TabBar />
      <TabContent />
    </div>
  );
}
