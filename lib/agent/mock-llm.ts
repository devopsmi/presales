import type { PipelineState } from "@/lib/agent/state";
import type { QuotationRow } from "@/lib/agent/state";
import type { TradeRole } from "@/lib/constants";
import { VENDOR_NAME } from "@/lib/constants";
import log from "@/lib/logger";

const mockLog = log.child({ module: "mock-llm" });

/**
 * Deterministic mock LLM that produces structured outputs based on agentName + state.
 * Swappable with a real LLM via the same (systemPrompt, userPrompt, agentName, state) interface.
 */
export async function runMockLlm(params: {
  systemPrompt: string;
  userPrompt: string;
  agentName: string;
  state: PipelineState;
}): Promise<string> {
  mockLog.debug("Mock LLM call", { agentName: params.agentName });

  try {
    switch (params.agentName) {
      case "parser":
        return mockParserOutput(params.state.rawText);
      case "decomposer":
        return mockDecomposerOutput(params.state.structuredBrief);
      case "estimator":
        return mockEstimatorOutput(params.userPrompt, params.state.selectedTrades);
      case "quoter":
        return mockQuoterOutput(params.state);
      default:
        throw new Error(`Unknown agent name: ${params.agentName}`);
    }
  } catch (err) {
    mockLog.error("Mock LLM call failed", {
      agentName: params.agentName,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Per-agent output generators
// ---------------------------------------------------------------------------

function mockParserOutput(rawText: string): string {
  const projectName = guessProjectName(rawText);
  const customerName = guessCustomerName(rawText);

  return `## ${projectName}

### 客户信息
- 客户名称：${customerName}
- 行业类型：互联网/电商

### 项目概述
${rawText}

### 核心模块
1. **用户端功能** - 面向终端用户的核心业务流程
2. **管理后台** - 运营管理相关的后台功能
3. **系统基础** - 技术架构、权限体系、数据安全等基础设施

### 技术要求
- 支持主流浏览器和移动端访问
- 采用前后端分离架构
- 数据安全保障措施
- 性能要求：页面加载时间 < 3秒

### 交付要求
- 完整可部署的系统源代码
- 技术文档及操作手册
- 上线部署及技术支持`;
}

function mockDecomposerOutput(_structuredBrief: string): string {
  const rows: Omit<QuotationRow, "trades" | "remark">[] = [
    {
      seq: 1,
      module: "系统设计",
      sub_module: "技术架构",
      function: "技术选型与架构设计",
      sub_function: "前后端技术栈选型",
      description: "确定前端框架、后端语言、数据库、缓存等技术组件，设计整体系统架构",
      category: "design",
    },
    {
      seq: 2,
      module: "系统设计",
      sub_module: "技术架构",
      function: "技术选型与架构设计",
      sub_function: "部署架构设计",
      description: "设计服务器部署方案、负载均衡、CDN加速等基础设施架构",
      category: "design",
    },
    {
      seq: 3,
      module: "系统设计",
      sub_module: "数据设计",
      function: "数据建模与数据库设计",
      sub_function: "概念数据模型设计",
      description: "设计ER图，定义核心实体（用户、商品、订单等）及关系",
      category: "design",
    },
    {
      seq: 4,
      module: "系统设计",
      sub_module: "数据设计",
      function: "数据建模与数据库设计",
      sub_function: "物理数据库设计",
      description: "设计具体表结构、索引策略、分库分表方案",
      category: "design",
    },
    {
      seq: 5,
      module: "系统设计",
      sub_module: "UI/UX设计",
      function: "用户界面与交互设计",
      sub_function: "整体UI风格设计",
      description: "确定色彩体系、字体规范、组件样式等视觉设计语言",
      category: "design",
    },
    {
      seq: 6,
      module: "系统设计",
      sub_module: "UI/UX设计",
      function: "用户界面与交互设计",
      sub_function: "核心页面交互设计",
      description: "设计首页、商品列表、购物车、订单等核心页面的交互流程",
      category: "design",
    },
    {
      seq: 7,
      module: "用户端",
      sub_module: "商品展示",
      function: "商品浏览与搜索",
      sub_function: "商品列表与分类展示",
      description: "实现商品列表、分类导航、筛选排序、搜索等功能",
      category: "feature",
    },
    {
      seq: 8,
      module: "用户端",
      sub_module: "商品展示",
      function: "商品浏览与搜索",
      sub_function: "商品详情页",
      description: "商品详情展示，包括图片轮播、规格选择、价格展示、用户评价",
      category: "feature",
    },
    {
      seq: 9,
      module: "用户端",
      sub_module: "购物车",
      function: "购物车管理",
      sub_function: "购物车增删改查",
      description: "添加商品到购物车、修改数量、删除商品、选择结算",
      category: "feature",
    },
    {
      seq: 10,
      module: "用户端",
      sub_module: "订单支付",
      function: "订单管理",
      sub_function: "订单创建与支付",
      description: "下单流程、地址管理、支付集成（微信/支付宝）、订单状态流转",
      category: "feature",
    },
    {
      seq: 11,
      module: "用户端",
      sub_module: "用户中心",
      function: "个人中心",
      sub_function: "用户信息管理",
      description: "用户注册登录、个人信息编辑、收货地址管理、浏览历史",
      category: "feature",
    },
    {
      seq: 12,
      module: "管理后台",
      sub_module: "商品管理",
      function: "商品信息管理",
      sub_function: "商品上架与编辑",
      description: "商品录入、编辑、上下架、库存管理、规格管理",
      category: "feature",
    },
  ];

  // Attach empty trades and remark to each row
  const fullRows: QuotationRow[] = rows.map((r) => ({
    ...r,
    trades: {},
    remark: "",
  }));

  return JSON.stringify(fullRows, null, 2);
}

function mockEstimatorOutput(userPrompt: string, selectedTrades: readonly TradeRole[]): string {
  const rows = extractJsonArrayFromPrompt(userPrompt);
  if (rows.length === 0) {
    throw new Error("Estimator mock: could not find JSON rows in userPrompt");
  }

  const filled = rows.map((row: Record<string, unknown>, idx: number) => {
    const trades: Partial<Record<TradeRole, number | null>> = {};
    const category = (row.category as string) ?? "feature";

    for (const trade of selectedTrades) {
      if (category === "design") {
        // Design rows: only backend (architecture/dev) gets estimates, design gets estimates
        if (trade === "backend" || trade === "design") {
          trades[trade] = seededManDay(idx, trade, 2, 5);
        } else {
          trades[trade] = null;
        }
      } else {
        // Feature rows: frontend/backend/design get estimates, others null
        if (trade === "frontend" || trade === "backend" || trade === "design") {
          const minDays = trade === "design" ? 0.5 : 1;
          const maxDays = trade === "design" ? 2 : 3;
          trades[trade] = seededManDay(idx, trade, minDays, maxDays);
        } else if (trade === "testing") {
          trades[trade] = seededManDay(idx, trade, 0.5, 1.5);
        } else if (trade === "pm") {
          trades[trade] = seededManDay(idx, trade, 0.5, 1);
        } else {
          trades[trade] = null;
        }
      }
    }

    return {
      ...row,
      trades,
    };
  });

  return JSON.stringify(filled, null, 2);
}

function mockQuoterOutput(state: PipelineState): string {
  const customerName = state.customerName || "未指定客户";
  const projectName = state.projectName || "未指定项目";
  const today = new Date().toISOString().slice(0, 10);

  const header = {
    customerName,
    projectName,
    quoteDate: today,
    vendorName: VENDOR_NAME,
  };

  // Compute totals per trade from rows
  const tradeTotals: Record<string, number> = {};
  for (const row of state.rows) {
    for (const [trade, val] of Object.entries(row.trades)) {
      if (typeof val === "number") {
        tradeTotals[trade] = (tradeTotals[trade] || 0) + val;
      }
    }
  }

  // Daily rates
  const dailyRates: Record<string, number> = {
    frontend: 2000,
    backend: 2500,
    design: 2000,
    testing: 1800,
    pm: 3000,
    devops: 2800,
    data: 3000,
    ai: 4000,
  };

  let totalCost = 0;
  const breakdown = Object.entries(tradeTotals).map(([trade, days]) => {
    const rate = dailyRates[trade] ?? 2000;
    const cost = days * rate;
    totalCost += cost;
    return { trade, days: Math.round(days * 10) / 10, rate, cost };
  });

  const [budgetMin, budgetMax] = state.budgetRange;
  let budgetAdvice: string;
  if (totalCost <= budgetMin) {
    budgetAdvice = `预算充足，当前报价 ${totalCost.toLocaleString()} 元在客户预算下限 ${budgetMin.toLocaleString()} 元以下，建议保持现有方案。`;
  } else if (totalCost <= budgetMax) {
    budgetAdvice = `当前报价 ${totalCost.toLocaleString()} 元在客户预算范围内 (${budgetMin.toLocaleString()} - ${budgetMax.toLocaleString()} 元)，方案合理。`;
  } else {
    budgetAdvice = `⚠️ 当前报价 ${totalCost.toLocaleString()} 元超出客户预算上限 ${budgetMax.toLocaleString()} 元，建议适当裁剪功能或调整工种配比。`;
  }

  const summary = `## 报价摘要

| 工种 | 人天 | 单价(元) | 小计(元) |
|------|------|----------|----------|
${breakdown.map((b) => `| ${b.trade} | ${b.days} | ${b.rate} | ${b.cost.toLocaleString()} |`).join("\n")}
| **合计** | | | **${totalCost.toLocaleString()}** |

### 预算分析
${budgetAdvice}

### 报价说明
以上报价基于功能清单估算，实际工期可能因需求变更、技术难度等因素有所调整。
最终报价以合同为准。`;

  return JSON.stringify({ header, summary }, null, 2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessProjectName(rawText: string): string {
  const patterns = [
    /(?:做|开发|搭建|建设|实现)(?:一个?)?(.{2,15}?(?:系统|平台|小程序|App|应用|网站|商城|后台))/,
    /(?:项目[：:]\s*)(.+)/,
  ];
  for (const p of patterns) {
    const m = rawText.match(p);
    if (m?.[1]) {
      return m[1].trim();
    }
  }
  // Fallback: use first meaningful chunk
  const cleaned = rawText.replace(/[，。,.\s]+/g, "").slice(0, 20);
  return cleaned ? `${cleaned}项目` : "未命名项目";
}

function guessCustomerName(rawText: string): string {
  const patterns = [/客户[：:]\s*(.+)/, /(.+?)(?:公司|集团|企业|单位)/];
  for (const p of patterns) {
    const m = rawText.match(p);
    if (m?.[1]) {
      return m[1].trim();
    }
  }
  return "示例客户";
}

function extractJsonArrayFromPrompt(userPrompt: string): Record<string, unknown>[] {
  // Find the outermost JSON array in the prompt text
  const match = userPrompt.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }
  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // JSON may contain trailing content - try progressively shorter substrings
  }
  // Brute-force: find all `[{...}]` patterns and try to parse them
  const arrayPattern = /(\[[\s\S]*?\])/g;
  let m: RegExpExecArray | null;
  while ((m = arrayPattern.exec(userPrompt)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // keep trying
    }
  }
  return [];
}

/**
 * Deterministic pseudo-random man-day estimate based on row index and trade string.
 * Produces a value between minDays and maxDays (inclusive of 0.5 increments).
 */
function seededManDay(
  rowIdx: number,
  trade: string,
  minDays: number,
  maxDays: number,
): number {
  // Deterministic "hash" from rowIdx + trade
  let hash = rowIdx * 31;
  for (let i = 0; i < trade.length; i++) {
    hash = (hash * 17 + trade.charCodeAt(i)) & 0x7fffffff;
  }
  const range = maxDays - minDays;
  const steps = Math.round(range * 2); // half-day steps
  const step = hash % (steps + 1);
  const value = minDays + step * 0.5;
  return Math.round(value * 10) / 10;
}
