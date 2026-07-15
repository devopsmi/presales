"""
Pydantic 模型：定义请求与响应的数据结构。
"""

from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    """生成方案请求"""
    requirement: str = Field(..., min_length=1, description="需求描述文本")
    company_name: str = Field(default="", description="客户名称")
    project_name: str = Field(default="", description="项目名称")
    quotation_unit: str = Field(default="", description="报价单位")
    max_budget: float = Field(default=0, description="最高预算上限（0代表不限制）")
    roles: list[str] = Field(default=["后端工程师", "前端工程师", "测试工程师"], description="可用岗位列表")


class ReviewIssue(BaseModel):
    """审核问题"""
    type: str = Field(..., description="问题类型：missing_module / missing_feature / mismatch / unreasonable / extra_module")
    detail: str = Field(..., description="问题描述")
    suggestion: str = Field(default="", description="修改建议")


class ReviewResult(BaseModel):
    """审核结果"""
    passed: bool = Field(..., description="是否通过审核")
    issues: list[ReviewIssue] = Field(default_factory=list, description="问题列表")
    summary: str = Field(default="", description="总体评价")


class EstimateTask(BaseModel):
    """单个开发任务（对应模板中的一行）"""
    serial: int = Field(..., description="序号")
    module: str = Field(..., description="模块")
    sub_module: str = Field(..., description="子模块")
    feature: str = Field(..., description="功能")
    processor: str = Field(..., description="加工方")
    description: str = Field(..., description="功能描述")
    backend_days: float = Field(..., description="后端人天")
    frontend_days: float = Field(..., description="前端人天")
    test_days: float = Field(..., description="测试人天")
    remark: str = Field(default="", description="备注")


class Summary(BaseModel):
    """预算汇总统计（匹配模板底部）"""
    total_backend_days: float = Field(..., description="后端人天合计")
    total_frontend_days: float = Field(..., description="前端人天合计")
    total_test_days: float = Field(..., description="测试人天合计")
    backend_daily_rate: float = Field(default=850, description="后端单价（元/天）")
    frontend_daily_rate: float = Field(default=850, description="前端单价（元/天）")
    test_daily_rate: float = Field(default=750, description="测试单价（元/天）")
    backend_cost: float = Field(..., description="后端费用")
    frontend_cost: float = Field(..., description="前端费用")
    test_cost: float = Field(..., description="测试费用")
    total_labor_cost: float = Field(..., description="实时费合计")
    management_fee_rate: float = Field(default=0.15, description="管理费比例")
    tax_rate: float = Field(default=0.06, description="税率")
    management_fee: float = Field(..., description="管理费")
    tax: float = Field(..., description="税金")
    grand_total: float = Field(..., description="合计")


class EstimateResult(BaseModel):
    """预算估算结果"""
    tasks: list[EstimateTask] = Field(..., description="开发任务清单")
    summary: Summary = Field(..., description="汇总统计")


class DesignResult(BaseModel):
    """设计方案结果"""
    markdown: str = Field(..., description="设计文档 Markdown 内容")


class GenerateResponse(BaseModel):
    """生成方案响应"""
    design: DesignResult = Field(..., description="软件设计方案")
    estimate: EstimateResult = Field(..., description="开发预算估算")
    review: ReviewResult = Field(..., description="审核结果")
