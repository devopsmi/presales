"""OpenAI Agent — 调用 LLM 生成结构化需求分析。"""

import json
import logging
from typing import Any

from openai import OpenAI

from app.core.config import settings
from app.schemas.requirement import AnalysisPayload, RequirementNode, SourceBlock

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是一位资深的售前需求分析专家。你的任务是根据用户提供的项目材料（文件列表、文本描述、补充说明）进行需求分析，输出结构化的需求文档。

请按以下要求输出 JSON：
{
  "suggested_project_name": "推荐的项目名称（可为空）",
  "overview": "项目概述（一句话）",
  "requirements": [
    {
      "id": "r1",
      "module": "模块名称，如"客户管理"",
      "submodule": "子模块（可为空）",
      "feature": "功能名称",
      "subfeature": "子功能（可为空）",
      "description": "功能描述",
      "source_refs": ["材料来源文件名列表"],
      "pending_confirmation": false,
      "system_added": false,
      "suggested_roles": ["建议参与的角色名称"],
      "complexity_weight": 3
    }
  ],
  "conflicts": ["材料中发现的描述冲突列表"],
  "unanswered_questions": ["需要客户确认的问题列表"]
}

注意事项：
1. complexity_weight 为 1-5 的整数，表示功能复杂度
2. suggested_roles 从以下角色中选择：产品、前端、后端、测试
3. 每个需求必须有至少一个 source_refs
4. 如果某条需求是系统根据经验补充的（非材料直接提及），设置 system_added=true
5. 如果某条需求需要客户进一步确认，设置 pending_confirmation=true
6. 如果不同材料对同一功能描述有冲突，请在 conflicts 中列出"""


class OpenAIAgent:
    """真实 OpenAI Agent — 调用 LLM 生成结构化需求。"""

    def __init__(self, api_key: str | None = None, base_url: str | None = None) -> None:
        self.client = OpenAI(
            api_key=api_key or settings.openai_api_key,
            base_url=base_url or settings.openai_base_url,
        )

    def analyze(self, blocks: list[SourceBlock], supplement: str | None = None) -> AnalysisPayload:
        """分析来源块并返回结构化需求。"""
        materials_text = self._build_materials_text(blocks)
        user_prompt = self._build_user_prompt(materials_text, supplement)

        response = self.client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
        )

        content = response.choices[0].message.content
        if not content:
            raise ValueError("Agent 返回空响应")

        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            # DeepSeek 可能用 markdown 代码块包裹 JSON
            if "```json" in content:
                json_str = content.split("```json")[1].split("```")[0].strip()
                data = json.loads(json_str)
            elif "```" in content:
                json_str = content.split("```")[1].split("```")[0].strip()
                data = json.loads(json_str)
            else:
                raise ValueError(f"Agent 返回非 JSON 响应: {content[:200]}") from None

        return AnalysisPayload(**data)

    def _build_materials_text(self, blocks: list[SourceBlock]) -> str:
        if not blocks:
            return "（无材料）"
        lines = []
        for b in blocks:
            parts = [f"[来源] {b.source} (优先级: {b.priority})"]
            if b.text:
                parts.append(f"[内容] {b.text}")
            if b.image_path:
                parts.append(f"[图片] {b.image_path}")
            lines.append("\n".join(parts))
        return "\n---\n".join(lines)

    def _build_user_prompt(self, materials_text: str, supplement: str | None) -> str:
        prompt = f"以下是项目材料：\n\n{materials_text}\n"
        if supplement:
            prompt += f"\n用户补充说明：{supplement}\n"
        prompt += "\n请根据上述材料输出结构化需求分析。"
        return prompt
