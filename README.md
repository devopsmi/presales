# AI 软件方案设计 Agent（MVP）技术设计文档

**版本：V2.0**

------

# 一、项目目标

## 1.1 项目背景

软件项目立项阶段，通常需要架构师阅读需求文档，完成以下工作：

- 分析业务需求
- 设计系统架构
- 划分功能模块
- 输出软件设计方案
- 拆分开发任务
- 估算开发工作量
- 输出项目预算

整个过程需要大量人工参与。

本项目旨在利用大模型，实现从**需求输入**到**方案设计**再到**开发预算估算**的自动化。

------

## 1.2 项目目标

开发一个 Web Demo，实现以下能力：

用户输入一句需求，并上传需求文档。

例如：

> 设计一套疼痛管理系统

系统自动输出两份结果：

### 输出一：项目设计文档

包括：

- 项目简介
- 需求分析
- 系统架构
- 功能模块设计
- 技术方案
- 数据库建议
- API建议

采用 **Markdown** 输出。

------

### 输出二：项目开发估算清单

采用 **JSON** 输出，由前端渲染为表格。

包括：

- 功能模块
- 子功能
- 开发内容
- 开发角色
- 工作量
- 人天
- 开发成本
- 小计

最终统计：

- 总人天
- 总开发周期
- 建议团队人数
- 总成本
- 建议报价

------

# 二、系统功能

系统仅包含一个页面。

用户：

输入需求

↓

上传文档

↓

点击生成

↓

得到：

① 软件设计方案

② 项目开发预算

------

# 三、整体流程

```text
输入需求
      │
      ▼
上传参考文档
      │
      ▼
Document Parser
      │
      ▼
Requirement Analysis
      │
      ▼
Architecture Design
      │
      ▼
Module Split
      │
      ▼
Workload Estimate
      │
      ▼
Cost Estimate
      │
      ▼
输出设计文档
      │
      ▼
输出预算清单
```

------

# 四、系统架构

```
Vue3

    │

    ▼

FastAPI

    │

Workflow Controller

    │

──────────────────────────────

Document Parser

↓

Requirement Agent

↓

Architecture Agent

↓

Module Split Agent

↓

Estimate Agent

↓

Formatter

──────────────────────────────

返回 JSON
```

------

# 五、模块设计

## 1）Document Parser

职责：

解析：

- PDF
- Word
- txt

输出统一文本。

------

## 2）Requirement Agent

负责：

分析：

项目目标

用户角色

业务流程

核心需求

输出：

Markdown。

------

## 3）Architecture Agent

负责：

设计：

系统架构

模块关系

数据库建议

API建议

输出：

Markdown。

------

## 4）Module Split Agent（新增）

作用：

把系统继续拆细。

例如：

```
患者管理

↓

患者信息

患者建档

患者修改

患者删除

患者查询

患者导入

患者导出
```

再例如：

```
疼痛评估

↓

VAS评分

NRS评分

量表管理

历史评分

评分趋势分析
```

这个 Agent 的作用就是：

把所有开发功能拆出来。

后续 Estimate 使用。

------

## 5）Estimate Agent

输入：

Module Split。

输出：

开发预算。

采用 JSON。

------

# 六、设计文档输出

设计文档：

全部 Markdown。

包括：

```
# 项目介绍

# 项目目标

# 用户角色

# 系统架构

# 功能模块

## 患者管理

...

## 医生管理

...

## 数据库设计建议

...

## API设计建议

...
```

前端：

Markdown 渲染。

------

# 七、预算清单输出

预算清单：

采用 JSON。

前端：

Table。

Estimate Agent 不输出 Markdown。

------

## 表格结构

建议：

| 一级模块 | 二级模块 | 功能     | 开发岗位 | 工作内容 | 人天 | 人数 | 开发周期 | 小计   |
| -------- | -------- | -------- | -------- | -------- | ---- | ---- | -------- | ------ |
| 患者管理 | 患者信息 | 患者新增 | 后端     | API开发  | 1    | 1    | 1天      | ￥2000 |
| 患者管理 | 患者信息 | 患者新增 | 前端     | 页面开发 | 1    | 1    | 1天      | ￥1800 |
| 患者管理 | 患者信息 | 患者新增 | 测试     | 功能测试 | 0.5  | 1    | 0.5天    | ￥800  |
| 患者管理 | 患者信息 | 患者编辑 | 后端     | API开发  | 1    | 1    | 1天      | ￥2000 |
| 患者管理 | 患者信息 | 患者编辑 | 前端     | 页面开发 | 1    | 1    | 1天      | ￥1800 |
| ...      | ...      | ...      | ...      | ...      | ...  | ...  | ...      | ...    |

注意：

不是：

```
患者管理

10人天
```

而是：

一直拆到：

**一个开发任务。**

------

# 八、Estimate Agent 输出

固定 JSON。

例如：

```json
{
  "tasks": [
    {
      "module": "患者管理",
      "sub_module": "患者信息",
      "feature": "新增患者",
      "role": "后端工程师",
      "work": "接口开发",
      "days": 1,
      "people": 1,
      "cost": 2000
    }
  ],
  "summary": {
    "total_person_days": 126,
    "team_size": 5,
    "duration": "3个月",
    "development_cost": 268000,
    "management_cost": 35000,
    "recommended_quote": 390000
  }
}
```

------

# 九、接口返回

```
POST /generate
```

返回：

```json
{
  "design": {
    "markdown": "..."
  },
  "estimate": {
    "tasks": [],
    "summary": {}
  }
}
```

设计文档：

Markdown。

预算：

JSON。

------

# 十、页面设计

页面：

输入区。

↓

结果区。

------

结果区：

## 软件设计方案

Markdown。

------

## 开发预算

Table。

支持：

排序。

分页。

搜索。

------

下面：

Card。

显示：

```
总人天

126
预计周期

3个月
团队人数

5人
研发成本

26.8万元
建议报价

39万元
```

------

# 十一、目录

```
backend/

    parser/

    prompts/

        requirement.txt

        architecture.txt

        split.txt

        estimate.txt

    workflow.py

frontend/

    Home.vue

    MarkdownView.vue

    EstimateTable.vue
```

------

# 十二、Prompt

Prompt：

Requirement。

↓

Architecture。

↓

Module Split。

↓

Estimate。

一共：

四个 Prompt。

------

# 十三、MVP 不实现

- 登录
- 权限
- 数据库存储
- 多项目
- 历史记录
- RAG
- LangGraph
- 多Agent协作
- 流式输出
- Word 导出
- PDF 导出
- Mermaid
- PlantUML
- Docker