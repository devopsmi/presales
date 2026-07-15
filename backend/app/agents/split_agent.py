"""
模块拆分 Agent

读取架构设计结果，调用 LLM 将系统拆分为细粒度开发任务，
输出与报价单模板格式一致的 JSON 数组。
"""

import json
import re
from typing import Any

from app.agents.base import BaseAgent


class SplitAgent(BaseAgent):
    """负责将模块拆解为功能行（含后端/前端/测试人天估算）。"""

    prompt_path = "app/prompts/split.txt"

    async def run(self, context: dict[str, Any]) -> str:
        """执行模块拆分，将 JSON 任务列表写入 context['split_result']。"""
        architecture_result = context.get("architecture_result", "")
        roles = context.get("roles", ["后端工程师", "前端工程师", "测试工程师"])
        max_budget = context.get("max_budget", 0)
        review_feedback = context.get("review_feedback", "")

        roles_info = "、".join(roles)
        max_budget_info = f"总预算不得超过 {max_budget} 元。" if max_budget > 0 else "预算不设上限。"

        prompt_template = self._load_prompt()
        prompt = (
            prompt_template
            .replace("{architecture_result}", architecture_result)
            .replace("{roles_info}", roles_info)
            .replace("{max_budget_info}", max_budget_info)
            .replace("{review_feedback}", review_feedback)
        )
        raw = await self._call_llm(prompt)
        parsed = self._parse_json(raw)
        context["split_result"] = parsed

        if isinstance(parsed, list):
            return json.dumps(parsed, ensure_ascii=False, indent=2)
        return raw

    def _load_prompt(self) -> str:
        from pathlib import Path
        path = Path(__file__).parents[2] / self.prompt_path
        return path.read_text(encoding="utf-8")

    def _parse_json(self, raw: str) -> list[dict]:
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
