"""
Agent 基类

封装对 OpenAI 兼容接口的 LLM 调用，
提供 retry、超时、错误处理等通用能力。
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Any

from httpx import AsyncClient, Timeout

from app.config import settings

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """所有 Agent 的基类，封装 LLM 调用逻辑。"""

    # 子类通过 class attribute 指定 prompt 文件路径
    prompt_path: str = ""

    def __init__(self) -> None:
        self._api_key = settings.llm_api_key
        self._base_url = settings.llm_base_url.rstrip("/")
        self._model = settings.llm_model

        self._timeout = settings.llm_timeout
        self._max_retries = 2

    async def _call_llm(self, prompt: str) -> str:
        """
        调用 LLM，返回响应文本。

        参数:
            prompt: 完整的 prompt（含 system + user 消息）

        返回:
            LLM 返回的文本内容

        抛出:
            RuntimeError: 多次重试后仍然失败
        """
        last_error: Exception | None = None

        for attempt in range(self._max_retries + 1):
            try:
                return await self._do_call(prompt)
            except Exception as e:
                last_error = e
                logger.warning(
                    "LLM 调用失败 (attempt %d/%d): %s",
                    attempt + 1,
                    self._max_retries + 1,
                    e,
                )
                if attempt < self._max_retries:
                    wait = 2**attempt  # 指数退避
                    await asyncio.sleep(wait)

        raise RuntimeError(f"LLM 调用多次重试后失败: {last_error}")

    async def _do_call(self, prompt: str) -> str:
        """实际的 HTTP 请求逻辑。"""
        url = f"{self._base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        # 禁用思考模式时，追加指令让模型跳过推理直接输出
        system_content = prompt
        if not settings.llm_thinking:
            system_content += "\n\n重要：请直接输出结果，不要展示任何推理过程、思考步骤或解释。"

        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_content},
            ],
        }

        async with AsyncClient(timeout=Timeout(self._timeout)) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            choices = data.get("choices", [])
            if not choices:
                raise ValueError("LLM 返回的 choices 为空")
            content = choices[0].get("message", {}).get("content", "")
            return content

    @abstractmethod
    async def run(self, context: dict[str, Any]) -> str:
        """
        执行 Agent 逻辑，读取 context，返回结果文本。

        参数:
            context: 上下文字典，包含上游 Agent 的输出

        返回:
            Agent 输出文本（Markdown 或 JSON）
        """
        ...
