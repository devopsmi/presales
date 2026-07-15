"""
FastAPI 应用入口

初始化应用、注册 CORS 中间件、挂载路由。
"""

import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.router import router

# 配置日志格式
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="AI 软件方案设计 Agent",
    description="从需求输入到方案设计再到开发预算估算的自动化系统",
    version="0.1.0",
)

# CORS 配置
origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(router)


@app.get("/health")
async def health() -> dict[str, str]:
    """健康检查端点"""
    return {"status": "ok"}


def main() -> None:
    """启动 uvicorn 服务器。"""
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )


if __name__ == "__main__":
    main()
