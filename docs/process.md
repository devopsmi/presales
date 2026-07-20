# 方案设计与报价Agent — 开发进度

## 项目信息
- **开始时间**: 2026-07-20
- **技术栈**: Next.js 16 (App Router) + React 19 + Tailwind CSS v4 + shadcn/ui + Agent Elements + LangChain + Vercel AI SDK
- **当前状态**: ✅ v1 MVP 开发完成

---

## 进度总览

| 阶段 | 任务数 | 状态 | 说明 |
|------|--------|------|------|
| Wave 1: 基础依赖 | 1 | ✅ 完成 | pnpm 安装 ai, @langchain/*, pdf-parse, mammoth, xlsx, exceljs, jspdf, @tabler/icons-react, vitest, tsx |
| Wave 2: 基础原语与核心模块 | 4 | ✅ 完成 | shadcn primitives (15+), Agent Elements (41 files), lib/constants.ts, lib/agent/state.ts, file-parser (14/14 tests), xlsx-generator (22/22 tests) |
| Wave 3: Agent 层 | 3 | ✅ 完成 | Mock LLM + 4 pipeline nodes (parser/decomposer/estimator/quoter), 4 prompt templates, PresalesProvider context |
| Wave 4: API + UI 组件 | 5 | ✅ 完成 | pipeline.ts (22/22 tests), /api/chat route, file-upload-menu + trade-selector + budget-slider, model-picker, quotation-table |
| Wave 5: 组合层 | 4 | ✅ 完成 | config-bar, quotation-header + export-buttons + /api/quotation/export, result-panel, agent-chat-panel |
| Wave 6: 页面组装 + E2E | 2 | ✅ 完成 | app/page.tsx (60/40 双栏布局), E2E quotation 数据提取与分发 |
| Wave 7: 验证 | 1 | ✅ 完成 | tsc --noEmit clean, next build passed, SSE stream smoke test passed |

---

## 已实现功能

### 前端
- ✅ 左右双栏布局 (60% Agent对话框 + 40% 报价结果面板)
- ✅ Agent Elements AgentChat 集成 (useChat)
- ✅ ConfigBar: 文件上传菜单 (PDF/Word/Excel, 10MB限制) + 工种选择器 (行业Tab + 多选) + 预算滑块 + 模型选择器
- ✅ 报价表格 (shadcn Table, rowSpan 合并单元格, 动态工种列, 固定表头)
- ✅ 表头信息区 (客户名称/项目名称/报价时间/报价单位)
- ✅ .xlsx 下载 (PDF导出按钮已预留, v2 支持)
- ✅ 空状态占位

### 后端
- ✅ `/api/chat` — SSE 流式 API (兼容 AI SDK v4), 配置解析, 4-Agent pipeline 串行执行
- ✅ `/api/quotation/export` — .xlsx 生成与下载
- ✅ Mock LLM 模式 (默认, 无需 API Key)
- ✅ 环境变量 `LLM_PROVIDER=openai` 支持切换真实 LLM
- ✅ 文件解析工具 (pdf-parse, mammoth, xlsx)

### Agent Pipeline
- ✅ Agent-1 (Parser): 解析需求文字 → 结构化 Markdown
- ✅ Agent-2 (Decomposer): 拆解为 5 级功能清单 (模块/子模块/功能/子功能)
- ✅ Agent-3 (Estimator): 按用户所选工种评估人天 (设计类 vs 业务功能类)
- ✅ Agent-4 (Quoter): 生成报价表头 + 汇总数据 + pipeline_complete 事件
- ✅ 流式进度反馈 (agent_start → agent_progress → agent_complete)

### 测试
- ✅ file-parser: 14 assertions (pdf/word/excel 解析 + 错误处理)
- ✅ xlsx-generator: 22 assertions (合并单元格 + 内容验证)
- ✅ pipeline nodes: 24 assertions (4 节点串行 + 事件序列)
- ✅ pipeline: 22 assertions (完整 pipeline + 事件排序 + quotation 数据)
- ✅ tsc --noEmit: 0 errors
- ✅ next build: Compiled successfully

---

## 目录结构

```
presales/
├── app/
│   ├── api/
│   │   ├── chat/route.ts              # SSE 流式对话 API
│   │   └── quotation/export/route.ts  # .xlsx 导出 API
│   ├── layout.tsx                     # RootLayout (TooltipProvider)
│   ├── page.tsx                       # 主页面 (60/40 双栏)
│   └── globals.css                    # Tailwind v4 + shadcn 主题
├── components/
│   ├── agent-elements/                # Agent Elements (41 files, shadcn registry)
│   ├── ui/                            # shadcn primitives (16 components)
│   └── presales/
│       ├── agent-chat-panel.tsx       # 左侧 Agent 对话框 (useChat + E2E wiring)
│       ├── config-bar.tsx             # 配置栏 (4 控件组合)
│       ├── file-upload-menu.tsx       # 文件上传下拉菜单
│       ├── trade-selector.tsx         # 工种选择器 (行业Tab + 多选)
│       ├── budget-slider.tsx          # 预算范围双滑块
│       ├── model-picker.tsx           # 模型选择器
│       ├── result-panel.tsx           # 右侧报价结果面板
│       ├── quotation-table.tsx        # 报价表格 (rowSpan 合并)
│       ├── quotation-header.tsx       # 表头信息区
│       └── export-buttons.tsx         # 下载按钮组 (.xlsx + PDF)
├── lib/
│   ├── agent/
│   │   ├── pipeline.ts                # LangGraph pipeline 定义 (async generator)
│   │   ├── state.ts                   # PipelineState, PipelineEvent, QuotationRow
│   │   ├── mock-llm.ts                # 确定性 Mock LLM
│   │   ├── nodes/
│   │   │   ├── parser.ts              # Agent-1: 文档解析
│   │   │   ├── decomposer.ts          # Agent-2: 需求拆解
│   │   │   ├── estimator.ts           # Agent-3: 工时评估
│   │   │   ├── quoter.ts              # Agent-4: 报价生成
│   │   │   └── __tests__/run-all.ts   # 节点集成测试
│   │   ├── tools/
│   │   │   ├── file-parser.ts         # PDF/Word/Excel 解析
│   │   │   ├── xlsx-generator.ts      # .xlsx 生成 (exceljs)
│   │   │   └── __tests__/
│   │   ├── prompts/
│   │   │   ├── parser.md              # Agent-1 系统提示
│   │   │   ├── decomposer.md          # Agent-2 系统提示
│   │   │   ├── estimator.md           # Agent-3 系统提示
│   │   │   └── quoter.md              # Agent-4 系统提示
│   │   └── __tests__/pipeline.test.ts # Pipeline 集成测试
│   ├── constants.ts                   # 工种/行业/预算/模型常量
│   ├── presales-context.tsx           # React Context (usePresales)
│   └── utils.ts                       # cn() 工具函数
└── docs/
    ├── design.md                      # 系统设计文档
    └── process.md                     # 本文档 (开发进度)
```

---

## 运行方式

```bash
# 开发模式
pnpm dev

# 构建
pnpm build

# 类型检查
pnpm typecheck

# 测试
pnpm test

# Mock 模式 (默认, 无需 API Key)
pnpm dev

# 真实 LLM 模式
LLM_PROVIDER=openai OPENAI_API_KEY=sk-xxx pnpm dev
```

---

## 后续扩展 (v2+)
- [ ] 真实 LLM 对接 (LangChain ChatOpenAI 集成)
- [ ] 文件上传 (FormData) 完整支持
- [ ] PDF 导出 (jspdf)
- [ ] 历史报价数据库 + 向量检索
- [ ] 多轮对话澄清模糊需求
- [ ] 报价对比模式 (2-3 方案)
- [ ] 团队匹配 (人员配置推荐)
- [ ] Dark mode
- [ ] 移动端适配
