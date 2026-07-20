# 方案设计与报价Agent

AI驱动的产品方案设计与工时报价系统。

用户通过 Agent 对话框提交产品需求，系统自动交付：
- 产品功能需求拆解清单
- 对应工时报价表

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Next.js 16 (App Router) + React 19 |
| UI 组件库 | shadcn/ui + Agent Elements |
| 样式系统 | Tailwind CSS v4 |
| AI 编排 | LangChain / LangGraph |
| 流式通信 | Vercel AI SDK (useChat) |
| 文件解析 | pdf-parse, mammoth, xlsx |
| 表格导出 | exceljs, jspdf |

## 快速开始

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 使用。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_PROVIDER` | LLM 模式: `mock` (模拟) 或 `openai` (真实) | `mock` |
| `OPENAI_API_KEY` | OpenAI API Key (LLM_PROVIDER=openai 时需要) | - |

Mock 模式下无需任何 API Key，使用确定性模板生成报价数据。

## 脚本

```bash
pnpm dev          # 开发服务器
pnpm build        # 生产构建
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint
pnpm test         # 运行所有测试
pnpm test:parser  # 文件解析测试
pnpm test:xlsx    # Excel 生成测试
pnpm test:nodes   # Agent 节点测试
pnpm test:pipeline # Pipeline 集成测试
```

## 架构

```
用户输入 (文字 + 附件 + 工种/预算/模型)
        │
        ▼
┌──────────────────────┐
│  Agent-1: 文档解析    │ → 结构化需求文档
├──────────────────────┤
│  Agent-2: 需求拆解    │ → 功能清单 (5级层次)
├──────────────────────┤
│  Agent-3: 工时评估    │ → 各工种人天估算
├──────────────────────┤
│  Agent-4: 报价生成    │ → 最终报价表 (.xlsx)
└──────────────────────┘
        │
        ▼
    报价表格 + .xlsx 下载
```

## 目录结构

```
presales/
├── app/
│   ├── api/chat/route.ts          # SSE 流式对话 API
│   ├── api/quotation/export/      # .xlsx 导出 API
│   └── page.tsx                   # 主页面
├── components/
│   ├── agent-elements/            # Agent Elements 组件库
│   ├── ui/                        # shadcn 基础组件
│   └── presales/                  # 业务组件
├── lib/
│   ├── agent/                     # Agent Pipeline (nodes, tools, prompts)
│   ├── constants.ts               # 常量定义
│   └── presales-context.tsx       # React Context
└── docs/
    ├── design.md                  # 系统设计文档
    └── process.md                 # 开发进度
```

## License

Private
