"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomToolRendererProps } from "@/components/agent-elements/types";
import {
  IconFileText,
  IconSearch,
  IconReceipt,
  IconCheck,
  IconLoader2,
  IconCircleX,
  IconChevronDown,
  IconChevronRight,
  IconFileCheck,
  IconFileAlert,
  IconCircleCheck,
  IconAlertTriangle,
  IconCoins,
} from "@tabler/icons-react";

// ===========================================================================
// Shared helpers
// ===========================================================================

function useElapsed(status: string) {
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef(Date.now());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (status === "pending" || status === "streaming") {
      startedAtRef.current = Date.now();
      const interval = setInterval(() => {
        if (mountedRef.current) setElapsed(Date.now() - startedAtRef.current);
      }, 1000);
      return () => {
        mountedRef.current = false;
        clearInterval(interval);
      };
    }
  }, [status]);

  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function PendingHeader({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
      <IconLoader2 className="size-4 text-blue-500 animate-spin shrink-0" />
      <Icon className="size-4 text-blue-400/60 shrink-0" />
      <span>{label}</span>
    </div>
  );
}

function SuccessHeader({
  icon: Icon,
  label,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <IconCheck className="size-4 text-green-500 shrink-0" />
      <Icon className="size-4 text-green-400/60 shrink-0" />
      <span className="font-medium">{label}</span>
      {detail && (
        <span className="text-an-foreground-muted/60 font-normal">{detail}</span>
      )}
    </div>
  );
}

function ErrorHeader({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-red-500">
      <IconCircleX className="size-4 shrink-0" />
      <Icon className="size-4 shrink-0" />
      <span>{label}</span>
    </div>
  );
}

// ===========================================================================
// ParsedFileDisplay — collapsible parsed file list
// ===========================================================================

interface ParsedFileEntry {
  name: string;
  type: string;
  parsed?: string;
}

function ParsedFileList({ files }: { files: ParsedFileEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-an-foreground-muted/60 hover:text-an-foreground-muted transition-colors"
      >
        {expanded ? <IconChevronDown className="size-3" /> : <IconChevronRight className="size-3" />}
        {files.length} 个已解析文件
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-xs text-an-foreground-muted/50 pl-4"
            >
              <IconFileCheck className="size-3 text-green-400/60 shrink-0" />
              <span className="truncate">{f.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// 1. FileParserCard — subagent_file_parser
// ===========================================================================

export function FileParserCard({ status, output }: CustomToolRendererProps) {
  const elapsed = useElapsed(status);
  const parsedFiles: ParsedFileEntry[] = (() => {
    if (!output || typeof output !== "object") return [];
    const o = output as Record<string, unknown>;
    if (Array.isArray(o.parsedFiles)) return o.parsedFiles as ParsedFileEntry[];
    return [];
  })();
  const parsedCount = parsedFiles.length;
  const unparsedCount =
    (output && typeof output === "object" ? (output as Record<string, unknown>).unparsedCount : 0) as number ?? 0;

  if (status === "error") return <ErrorHeader icon={IconFileText} label="文档解析失败" />;

  if (status === "success" || (output && typeof output === "object")) {
    if (parsedCount > 0) {
      return (
        <div className="space-y-1">
          <SuccessHeader
            icon={IconFileText}
            label="文档解析完成"
            detail={unparsedCount > 0 ? `${parsedCount} 成功 / ${unparsedCount} 失败` : `${parsedCount} 个文件`}
          />
          <ParsedFileList files={parsedFiles} />
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <IconFileAlert className="size-4 text-amber-400 shrink-0" />
        <span>无可解析文件</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <PendingHeader icon={IconFileText} label="文档解析中..." />
        <span className="text-xs text-an-foreground-muted/50 tabular-nums">{elapsed}</span>
      </div>
      {/* Animated shimmer bar while waiting */}
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-400/40"
          style={{
            width: "60%",
            animation: "shimmer 2s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}

// ===========================================================================
// 2. GrillMeCard — grill_me
// ===========================================================================

function computeGrillStats(output: unknown): {
  isComplete: boolean;
  questionCount: number;
  dimensionCount: number;
  preview: string;
} {
  if (!output || typeof output !== "object") {
    return { isComplete: false, questionCount: 0, dimensionCount: 0, preview: "" };
  }
  const o = output as Record<string, unknown>;
  const text = typeof o.output === "string" ? o.output : "";
  const isComplete = o.isComplete === true;

  // Count "### " headings as dimensions, "**Q" as questions
  const dimensionCount = (text.match(/^### /gm) || []).length;
  const questionCount = (text.match(/\*\*Q\d+/g) || []).length;
  const preview = text.slice(0, 120).replace(/\n/g, " ").trim();

  return { isComplete, questionCount, dimensionCount, preview };
}

export function GrillMeCard({ status, output }: CustomToolRendererProps) {
  const elapsed = useElapsed(status);

  if (status === "error") return <ErrorHeader icon={IconSearch} label="需求澄清失败" />;

  if (status === "success" || (output && typeof output === "object")) {
    const { isComplete, questionCount, dimensionCount } = computeGrillStats(output);
    return (
      <div className="flex items-center gap-2 text-sm">
        {isComplete ? (
          <>
            <IconCircleCheck className="size-4 text-green-500 shrink-0" />
            <IconSearch className="size-4 text-green-400/60 shrink-0" />
            <span className="font-medium text-muted-foreground">需求澄清完成</span>
            <span className="text-green-600 text-xs">需求完整 ✓</span>
          </>
        ) : (
          <>
            <IconAlertTriangle className="size-4 text-amber-500 shrink-0" />
            <IconSearch className="size-4 text-amber-400/60 shrink-0" />
            <span className="font-medium text-muted-foreground">需求澄清完成</span>
            <span className="text-an-foreground-muted/60 text-xs">
              {dimensionCount > 0 ? `${dimensionCount} 个维度` : ""}
              {questionCount > 0 ? ` · ${questionCount} 个追问` : ""}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between w-full">
      <PendingHeader icon={IconSearch} label="需求澄清中..." />
      <span className="text-xs text-an-foreground-muted/50 tabular-nums">{elapsed}</span>
    </div>
  );
}

// ===========================================================================
// 3. EstimatorCard — subagent_estimator
// ===========================================================================

interface EstimatorOutput {
  header?: { projectName?: string; customerName?: string };
  rows?: unknown[];
  tradeTotals?: Record<string, number>;
  totalCost?: number;
  budgetAdvice?: string;
}

function computeEstimatorStats(output: unknown): EstimatorOutput {
  if (!output || typeof output !== "object") return {};
  return output as EstimatorOutput;
}

function formatCost(cost: number): string {
  if (cost >= 10000) return `${(cost / 10000).toFixed(1)} 万元`;
  return `${cost.toLocaleString()} 元`;
}

export function EstimatorCard({ status, output }: CustomToolRendererProps) {
  const elapsed = useElapsed(status);

  if (status === "error") return <ErrorHeader icon={IconReceipt} label="报价生成失败" />;

  if (status === "success" || (output && typeof output === "object")) {
    const stats = computeEstimatorStats(output);
    const projectName = stats.header?.projectName;
    const totalCost = stats.totalCost;
    const rowCount = Array.isArray(stats.rows) ? stats.rows.length : 0;
    const tradeCount = stats.tradeTotals ? Object.keys(stats.tradeTotals).length : 0;
    const budgetAdvice = stats.budgetAdvice;

    let budgetColor = "text-an-foreground-muted/60";
    if (budgetAdvice) {
      if (budgetAdvice.includes("范围内")) budgetColor = "text-green-600";
      else if (budgetAdvice.includes("低于")) budgetColor = "text-amber-500";
      else if (budgetAdvice.includes("超出")) budgetColor = "text-red-500";
    }

    return (
      <div className="space-y-1.5">
        <SuccessHeader
          icon={IconReceipt}
          label="报价生成完成"
          detail={projectName || (rowCount > 0 ? `${rowCount} 项` : "")}
        />
        <div className="flex items-center gap-3 text-xs pl-6">
          {totalCost != null && (
            <span className="flex items-center gap-1 text-foreground/80 font-semibold">
              <IconCoins className="size-3 text-amber-500" />
              {formatCost(totalCost)}
            </span>
          )}
          {tradeCount > 0 && (
            <span className="text-an-foreground-muted/60">{tradeCount} 个工种</span>
          )}
          {budgetAdvice && (
            <span className={budgetColor}>{budgetAdvice}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 w-full">
      <div className="flex items-center justify-between">
        <PendingHeader icon={IconReceipt} label="工时估算中..." />
        <span className="text-xs text-an-foreground-muted/50 tabular-nums">{elapsed}</span>
      </div>
      {/* Segmented progress pulse */}
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full bg-muted overflow-hidden"
          >
            <div
              className="h-full rounded-full bg-amber-400/30"
              style={{
                width: "100%",
                animation: `shimmer 1.8s ease-in-out ${i * 0.3}s infinite`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// 4. WriteBriefCard — write_brief (not in mapToolName by default)
// ===========================================================================

export function WriteBriefCard({ status, output }: CustomToolRendererProps) {
  if (status === "error") return <ErrorHeader icon={IconFileText} label="简报保存失败" />;

  if (status === "success" || (output && typeof output === "object")) {
    const o = output as Record<string, unknown>;
    const customerName = typeof o.customerName === "string" ? o.customerName : "";
    const projectName = typeof o.projectName === "string" ? o.projectName : "";
    return (
      <SuccessHeader
        icon={IconFileText}
        label="需求简报已保存"
        detail={[projectName, customerName].filter(Boolean).join(" · ") || undefined}
      />
    );
  }

  return <PendingHeader icon={IconFileText} label="保存需求简报..." />;
}
