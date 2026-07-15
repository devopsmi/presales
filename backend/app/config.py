from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全局配置，所有敏感信息均从环境变量读取，禁止硬编码默认值。"""

    # LLM 配置（敏感信息必须通过环境变量或 .env 文件注入）
    llm_api_key: str
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-v4-flash"
    llm_max_tokens: int = 4096
    llm_temperature: float = 0.3
    llm_timeout: int = 500
    llm_thinking: bool = False  # 启用后模型会输出思考过程，速度较慢

    # 服务配置
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: str = "http://localhost:5173"

    # 文件上传限制（单位：MB）
    max_file_size_mb: int = 20

    model_config = SettingsConfigDict(
        env_prefix="",
        case_sensitive=False,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
