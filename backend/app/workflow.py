"""
Pipeline 编排器

按照 需求分析 → 架构设计 → 模块拆分（含定价） → 采购与汇总 → 审核 的顺序，
依次调用各 Agent，若审核不通过则自动重试（带反馈）。
"""

import logging
from typing import Any

from app.agents.requirement_agent import RequirementAgent
from app.agents.architecture_agent import ArchitectureAgent
from app.agents.split_agent import SplitAgent
from app.agents.estimate_agent import EstimateAgent
from app.agents.review_agent import ReviewAgent

logger = logging.getLogger(__name__)

MAX_REVIEW_RETRIES = 2


class WorkflowController:
    """工作流控制器，按 Pipeline 顺序调用各 Agent，支持审核重试。"""

    def __init__(self) -> None:
        self.pipeline_agents = [
            ("requirement", RequirementAgent()),
            ("architecture", ArchitectureAgent()),
        ]
        self.regenerable_agents = [
            ("split", SplitAgent()),
            ("estimate", EstimateAgent()),
        ]
        self.review_agent = ("review", ReviewAgent())

    async def run(
        self,
        requirement_text: str,
        doc_text: str = "",
        company_name: str = "",
        project_name: str = "",
        quotation_unit: str = "",
        max_budget: float = 0,
        roles: list[str] | None = None,
    ) -> dict[str, Any]:
        """
        执行完整的工作流，含审核与自动重试。
        """
        combined = requirement_text
        if doc_text:
            combined += f"\n\n参考文档内容：\n{doc_text}"
        if company_name:
            combined += f"\n\n客户名称：{company_name}"
        if project_name:
            combined += f"\n\n项目名称：{project_name}"

        context: dict[str, Any] = {
            "requirement_text": combined,
            "reference_text": doc_text,
            "company_name": company_name,
            "project_name": project_name,
            "quotation_unit": quotation_unit,
            "max_budget": max_budget,
            "roles": roles or ["后端工程师", "前端工程师", "测试工程师"],
        }

        # 1) 运行前置 Agent（requirement + architecture）
        logger.info("阶段一：需求分析与架构设计")
        for name, agent in self.pipeline_agents:
            logger.info("  执行 Agent: %s", name)
            await agent.run(context)

        # 2) 循环：拆分+估算 → 审核 → 重试
        for attempt in range(1, MAX_REVIEW_RETRIES + 2):
            logger.info("阶段二：模块拆分与估算（第 %d 次）", attempt)

            for name, agent in self.regenerable_agents:
                logger.info("  执行 Agent: %s", name)
                await agent.run(context)

            # 审核
            name, agent = self.review_agent
            logger.info("阶段三：审核")
            await agent.run(context)
            review = context.get("review_result", {})

            if isinstance(review, dict) and review.get("passed", False):
                logger.info("审核通过")
                break
            else:
                issues = review.get("issues", []) if isinstance(review, dict) else []
                summary = review.get("summary", "") if isinstance(review, dict) else ""
                logger.warning("审核未通过（第 %d 次）: %s", attempt, summary)
                for iss in issues:
                    logger.warning("  问题: %s - %s", iss.get("type", ""), iss.get("detail", ""))

                if attempt <= MAX_REVIEW_RETRIES:
                    # 将审核反馈注入 context，下次生成时参考
                    feedback = self._build_feedback(review)
                    context["review_feedback"] = feedback
                    # 清除前一次结果以便重新生成
                    context.pop("split_result", None)
                    context.pop("estimate_result", None)
                    logger.info("将审核反馈注入，准备重试...")
                else:
                    logger.warning("已达最大重试次数，接受当前结果")
                    break

        logger.info("工作流执行完成")
        return context

    def _build_feedback(self, review: dict) -> str:
        """将审核结果转为 LLM 可理解的反馈文本。"""
        issues = review.get("issues", [])
        if not issues:
            return ""
        lines = ["【上一轮审核反馈】", "请根据以下问题修正生成结果："]
        for iss in issues:
            lines.append(f"- [{iss.get('type', 'issue')}] {iss.get('detail', '')}")
        return "\n".join(lines)
