"""
需求分析 Agent

读取原始需求文本，调用 LLM 输出需求分析 Markdown。
"""

from typing import Any

from app.agents.base import BaseAgent


class RequirementAgent(BaseAgent):
    """负责分析项目需求，输出需求分析文档。"""

    prompt_path = "app/prompts/requirement.txt"

    async def run(self, context: dict[str, Any]) -> str:
        """执行需求分析，将结果写入 context['requirement_result']。"""
        input_text = context.get("requirement_text", "")
        prompt_template = self._load_prompt()
        prompt = prompt_template.replace("{input_text}", input_text)
        result = await self._call_llm(prompt)
        context["requirement_result"] = result
        return result

    def _load_prompt(self) -> str:
        """从文件中加载 prompt 模板。"""
        from pathlib import Path
        path = Path(__file__).parents[2] / self.prompt_path
        return path.read_text(encoding="utf-8")
