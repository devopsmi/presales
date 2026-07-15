"""
审核 Agent

对比参考文档与生成的任务清单，检查模块/功能一致性。
"""

import json
import re
from typing import Any

from app.agents.base import BaseAgent


class ReviewAgent(BaseAgent):
    """负责审核生成结果与参考文档的匹配度。"""

    prompt_path = "app/prompts/review.txt"

    async def run(self, context: dict[str, Any]) -> str:
        """执行审核，将结果写入 context['review_result']。"""
        reference_text = context.get("reference_text", "")
        tasks_data = context.get("split_result", [])
        estimate_data = context.get("estimate_result", {})
        tasks_json = json.dumps(tasks_data, ensure_ascii=False, indent=2)
        summary_json = json.dumps(estimate_data, ensure_ascii=False, indent=2)

        if not reference_text.strip():
            result = {
                "passed": True,
                "issues": [],
                "summary": "无参考文档，跳过审核。",
            }
            context["review_result"] = result
            return json.dumps(result, ensure_ascii=False, indent=2)

        prompt_template = self._load_prompt()
        prompt = (
            prompt_template
            .replace("{reference_text}", reference_text)
            .replace("{tasks_json}", tasks_json)
            .replace("{summary_json}", summary_json)
        )
        raw = await self._call_llm(prompt)
        parsed = self._parse_json(raw)
        context["review_result"] = parsed

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
        raise ValueError(f"无法解析审核 JSON:\n{raw[:500]}")
