"""
预算汇总 Agent

读取 Split Agent 输出的 JSON 任务清单，
按照报价单模板格式计算底部汇总数据。
"""

import json
import re
from typing import Any

from app.agents.base import BaseAgent


class EstimateAgent(BaseAgent):
    """负责计算人天汇总、各岗位费用及最终报价。"""

    prompt_path = "app/prompts/estimate.txt"

    async def run(self, context: dict[str, Any]) -> str:
        """执行预算汇总，将结果写入 context['estimate_result']。"""
        split_result = context.get("split_result", [])
        max_budget = context.get("max_budget", 0)

        tasks_json = json.dumps(split_result, ensure_ascii=False, indent=2)
        max_budget_info = f"预算上限为 {max_budget} 元。" if max_budget > 0 else "预算不设上限。"
        budget_constraint = (
            f"如果 grand_total 超过 {max_budget} 元，请适当调减各岗位天数（优先缩减非核心功能），确保 grand_total 不超过 {max_budget} 元。"
            if max_budget > 0
            else "无预算限制，按正常工作量计算。"
        )

        prompt_template = self._load_prompt()
        prompt = (
            prompt_template
            .replace("{tasks_json}", tasks_json)
            .replace("{max_budget_info}", max_budget_info)
            .replace("{budget_constraint}", budget_constraint)
        )
        raw = await self._call_llm(prompt)
        parsed = self._parse_json(raw)
        context["estimate_result"] = parsed

        if isinstance(parsed, dict):
            return json.dumps(parsed, ensure_ascii=False, indent=2)
        return raw

    def _load_prompt(self) -> str:
        from pathlib import Path
        path = Path(__file__).parents[2] / self.prompt_path
        return path.read_text(encoding="utf-8")

    def _parse_json(self, raw: str) -> dict:
        pattern = r"```(?:json)?\s*([\s\S]*?)```"
        matches = re.findall(pattern, raw)
        if matches:
            for m in matches:
                try:
                    return json.loads(m.strip())
                except json.JSONDecodeError:
                    continue
        try:
            return json.loads(raw.strip())
        except json.JSONDecodeError:
            pass
        raise ValueError(f"无法解析 LLM 返回的 JSON:\n{raw[:500]}")
