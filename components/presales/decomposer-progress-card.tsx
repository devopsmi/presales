"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import { usePresales } from "@/lib/presales-context";
import { IconCheck, IconLoader2, IconCircle } from "@tabler/icons-react";

interface ProgressData {
  stage: string;
  round: number;
  totalRounds: number;
  message: string;
}

interface ProgressResponse {
  progress: ProgressData | null;
  active: boolean;
}

const STAGE_LABELS = [
  "识别产品模块",
  "拆解子模块",
  "识别功能点",
  "生成子功能详情",
];

const STAGE_ORDER: Record<string, number> = {
  "识别产品模块": 0,
  "拆解子模块": 1,
  "识别功能点": 2,
  "生成子功能详情": 3,
};

export function DecomposerProgressCard({
  status,
  output,
}: CustomToolRendererProps) {
  const { sessionId } = usePresales();
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [active, setActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const res = await fetch(
        `/api/decompose/progress?sessionId=${encodeURIComponent(sessionId)}`,
        { signal: controller.signal },
      );
      if (!res.ok || !mountedRef.current) return;
      const data: ProgressResponse = await res.json();
      if (!mountedRef.current) return;
      setActive(data.active);
      if (data.progress) {
        setProgress(data.progress);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Poll silently fails — progress will update on next tick
    }
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;

    if (status === "pending" || status === "streaming") {
      poll();
      intervalRef.current = setInterval(poll, 800);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Final poll to catch the last progress update
      if (status === "success") {
        poll();
      }
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [status, poll]);

  // Determine current visual round (use progress data or fall back)
  const currentRound = progress?.round ?? 0;
  const activeStageIdx = progress
    ? STAGE_ORDER[progress.stage] ?? 0
    : 0;

  // Compute overall progress percentage for the bar
  const overallPercent = Math.round((currentRound / 4) * 100);

  // Success state
  if (status === "success" || (output && !active)) {
    let rowCount = 0;
    if (output && typeof output === "object") {
      rowCount = (output as { rowCount?: number }).rowCount ?? 0;
    }
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <IconCheck className="size-4 text-green-500 shrink-0" />
        <span>功能拆解完成</span>
        {rowCount > 0 && (
          <span className="text-an-foreground-muted/60">{rowCount} 个功能项</span>
        )}
      </div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div className="flex items-center gap-2 text-sm text-red-500">
        <IconCircle className="size-4 shrink-0" />
        <span>功能拆解失败</span>
      </div>
    );
  }

  // Pending/streaming: show progress bar
  return (
    <div className="w-full space-y-3 py-1">
      {/* Header */}
      <div className="flex items-center gap-2">
        <IconLoader2 className="size-4 text-blue-500 animate-spin shrink-0" />
        <span className="text-sm font-medium text-foreground">功能拆解中</span>
        <span className="text-xs text-an-foreground-muted/60">
          {overallPercent}%
        </span>
      </div>

      {/* Stage nodes + connecting lines */}
      <div className="flex items-center justify-between px-1">
        {STAGE_LABELS.map((label, idx) => {
          const stageRoundIdx = idx + 1; // round number for this stage (1-4)
          const isCompleted = stageRoundIdx <= currentRound;
          const isActive = idx === activeStageIdx && !isCompleted;

          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              {/* Stage node */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <div
                  className={`size-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors duration-300 ${
                    isCompleted
                      ? "bg-green-500 text-white"
                      : isActive
                        ? "bg-blue-500 text-white ring-2 ring-blue-300 ring-offset-1"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isCompleted ? (
                    <IconCheck className="size-3.5" />
                  ) : isActive ? (
                    <IconLoader2 className="size-3.5 animate-spin" />
                  ) : (
                    stageRoundIdx
                  )}
                </div>
                <span
                  className={`text-[10px] leading-tight text-center max-w-[64px] transition-colors duration-300 ${
                    isCompleted
                      ? "text-green-600"
                      : isActive
                        ? "text-blue-600 font-medium"
                        : "text-muted-foreground/50"
                  }`}
                >
                  {label}
                </span>
              </div>

              {/* Connecting line (not after last) */}
              {idx < STAGE_LABELS.length - 1 && (
                <div className="flex-1 h-0.5 mx-1 mt-[-14px] rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      stageRoundIdx < currentRound
                        ? "bg-green-500"
                        : isActive
                          ? "bg-blue-300"
                          : "bg-transparent"
                    }`}
                    style={{
                      width:
                        stageRoundIdx < currentRound
                          ? "100%"
                          : isActive
                            ? "60%"
                            : "0%",
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Current message */}
      {progress?.message && (
        <p className="text-xs text-an-foreground-muted/60 text-center animate-pulse">
          {progress.message}
        </p>
      )}
    </div>
  );
}
