"""
架构设计 Agent

读取需求分析结果，调用 LLM 输出系统架构设计 Markdown。
"""

from typing import Any

from app.agents.base import BaseAgent


class ArchitectureAgent(BaseAgent):
    """负责设计系统架构，输出架构设计文档。"""

    prompt_path = "app/prompts/architecture.txt"

    async def run(self, context: dict[str, Any]) -> str:
        """执行架构设计，将结果写入 context['architecture_result']。"""
        requirement_result = context.get("requirement_result", "")
        prompt_template = self._load_prompt()
        prompt = prompt_template.replace("{requirement_result}", requirement_result)
        result = await self._call_llm(prompt)
        context["architecture_result"] = result
        return result

    def _load_prompt(self) -> str:
        """从文件中加载 prompt 模板。"""
        from pathlib import Path
        path = Path(__file__).parents[2] / self.prompt_path
        return path.read_text(encoding="utf-8")
