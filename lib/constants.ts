// Trade constants
export const TRADES = [
  { id: "frontend", label: "前端开发", dailyRate: 2000, icon: "Monitor" },
  { id: "backend", label: "后端开发", dailyRate: 2500, icon: "Server" },
  { id: "design", label: "UI 设计", dailyRate: 2000, icon: "Palette" },
  { id: "testing", label: "测试", dailyRate: 1800, icon: "Bug" },
  { id: "pm", label: "项目管理", dailyRate: 3000, icon: "Users" },
  { id: "devops", label: "DevOps", dailyRate: 2800, icon: "Cloud" },
  { id: "data", label: "数据分析", dailyRate: 3000, icon: "BarChart3" },
  { id: "ai", label: "AI/算法", dailyRate: 4000, icon: "Cpu" },
] as const;

export type TradeRole = (typeof TRADES)[number]["id"];

export const TRADE_LABELS: Record<TradeRole, string> = Object.fromEntries(
  TRADES.map((t) => [t.id, t.label])
) as Record<TradeRole, string>;

export const TRADE_DAILY_RATES: Record<TradeRole, number> = Object.fromEntries(
  TRADES.map((t) => [t.id, t.dailyRate])
) as Record<TradeRole, number>;

export const INDUSTRIES = ["电商", "金融", "医疗", "教育", "政务", "IoT", "SaaS", "其他"] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const INDUSTRY_DEFAULTS: Record<Industry, TradeRole[]> = {
  "电商": ["frontend", "backend", "design", "testing"],
  "金融": ["backend", "frontend", "testing", "devops"],
  "医疗": ["backend", "frontend", "testing", "data"],
  "教育": ["frontend", "backend", "design"],
  "政务": ["backend", "frontend", "pm", "testing"],
  "IoT": ["backend", "frontend", "devops", "ai"],
  "SaaS": ["frontend", "backend", "design", "testing", "devops"],
  "其他": ["frontend", "backend"],
};

export const BUDGET_PRESETS = [
  { label: "5万以下", range: [0, 50000] as const },
  { label: "5-15万", range: [50000, 150000] as const },
  { label: "15-30万", range: [150000, 300000] as const },
  { label: "30-50万", range: [300000, 500000] as const },
  { label: "50万以上", range: [500000, 2000000] as const },
];


export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_COUNT = 10;
export const MAX_SINGLE_FILE_SIZE_MB = 20;
export const ALLOWED_FILE_TYPES = ["pdf", "word", "excel", "image"] as const;
export const DEFAULT_MODEL = "deepseek-v3";
export const DEFAULT_INDUSTRY: Industry = "其他";

export const VENDOR_NAME = "重庆酷小贝软件开发有限公司";
