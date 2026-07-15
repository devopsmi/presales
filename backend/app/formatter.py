"""
结果格式化

将 WorkflowController 输出的 context 组装为 GenerateResponse。
"""

from typing import Any

from app.schemas import (
    GenerateResponse,
    DesignResult,
    EstimateResult,
    EstimateTask,
    Summary,
    ReviewResult,
    ReviewIssue,
)


class Formatter:
    """将 context 中的各 Agent 结果组装为统一的 API 响应。"""

    @staticmethod
    def format(context: dict[str, Any]) -> GenerateResponse:
        # 设计文档
        markdown_parts = [
            "# 项目介绍\n",
            context.get("requirement_result", ""),
            "\n\n",
            context.get("architecture_result", ""),
        ]
        design = DesignResult(markdown="\n".join(markdown_parts).strip())

        # 开发任务清单
        tasks_data = context.get("split_result", [])
        tasks = [EstimateTask(**t) for t in tasks_data] if isinstance(tasks_data, list) else []

        # 汇总统计
        summary_data = context.get("estimate_result", {}) or {}
        if isinstance(summary_data, dict) and summary_data.get("total_backend_days") is not None:
            summary = Summary(**summary_data)
        else:
            total_b = sum(t.backend_days for t in tasks)
            total_f = sum(t.frontend_days for t in tasks)
            total_t = sum(t.test_days for t in tasks)
            bc = total_b * 850
            fc = total_f * 850
            tc = total_t * 750
            labor = bc + fc + tc
            mgmt = labor * 0.15
            tax = (labor + mgmt) * 0.06
            summary = Summary(
                total_backend_days=total_b,
                total_frontend_days=total_f,
                total_test_days=total_t,
                backend_daily_rate=850,
                frontend_daily_rate=850,
                test_daily_rate=750,
                backend_cost=bc,
                frontend_cost=fc,
                test_cost=tc,
                total_labor_cost=labor,
                management_fee_rate=0.15,
                tax_rate=0.06,
                management_fee=mgmt,
                tax=tax,
                grand_total=labor + mgmt + tax,
            )

        # 审核结果
        review_data = context.get("review_result", {}) or {}
        if isinstance(review_data, dict) and "passed" in review_data:
            issues = [ReviewIssue(**i) for i in review_data.get("issues", [])]
            review = ReviewResult(
                passed=review_data["passed"],
                issues=issues,
                summary=review_data.get("summary", ""),
            )
        else:
            review = ReviewResult(passed=True, issues=[], summary="")

        return GenerateResponse(
            design=design,
            estimate=EstimateResult(tasks=tasks, summary=summary),
            review=review,
        )
