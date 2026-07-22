"use client";

import { usePresales, PresalesProvider } from "@/lib/presales-context";
import { AgentChatPanel } from "@/components/presales/agent-chat-panel";
import { ResultPanel } from "@/components/presales/result-panel";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

function ChatHeader() {
  const { reset } = usePresales();

  return (
    <div className="px-4 py-2.5 border-b bg-background flex items-center justify-between">
      <div>
        <h1 className="text-lg font-semibold">方案设计与报价Agent</h1>
        <p className="text-xs text-muted-foreground">AI驱动的产品方案设计与工时报价系统</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => reset()}
        className="text-muted-foreground hover:text-destructive"
      >
        <RotateCcw className="h-4 w-4 mr-1" />
        重置对话
      </Button>
    </div>
  );
}

function MainLayout() {
  const { sessionId } = usePresales();

  return (
    <div className="flex h-screen">
      <div className="w-full lg:w-[60%] flex flex-col border-r">
        <ChatHeader />
        <div className="flex-1 min-h-0" key={sessionId}>
          <AgentChatPanel />
        </div>
      </div>
      <div className="hidden lg:flex lg:w-[40%] flex-col">
        <div className="px-4 py-3 border-b bg-background">
          <h2 className="text-sm font-semibold">报价结果</h2>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <ResultPanel />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <PresalesProvider>
      <MainLayout />
    </PresalesProvider>
  );
}
