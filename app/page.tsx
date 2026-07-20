import { PresalesProvider } from "@/lib/presales-context";
import { AgentChatPanel } from "@/components/presales/agent-chat-panel";
import { ResultPanel } from "@/components/presales/result-panel";

export default function Home() {
  return (
    <PresalesProvider>
      <div className="flex h-screen">
        <div className="w-full lg:w-[60%] flex flex-col border-r">
          <div className="px-4 py-3 border-b bg-background">
            <h1 className="text-lg font-semibold">方案设计与报价Agent</h1>
            <p className="text-xs text-muted-foreground">AI驱动的产品方案设计与工时报价系统</p>
          </div>
          <div className="flex-1 min-h-0">
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
    </PresalesProvider>
  );
}
