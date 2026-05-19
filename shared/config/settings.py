"""
Centralised settings — reads from environment variables.

New production additions:
  - ai_demo_mode: disables Ollama, uses rich fallback responses in cloud
  - cors_origins: configurable comma-separated list for production CORS
  - environment: "development" | "production"
  - log_level: INFO in production, DEBUG in development
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    # ── Database ──────────────────────────────────────────────────────────────
    postgres_user: str = "sentinel"
    postgres_password: str = "sentinel"
    postgres_db: str = "sentinel_db"
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis_host: str = "localhost"
    redis_port: int = 6379

    # ── AI / Ollama ───────────────────────────────────────────────────────────
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5"

    # When True: skip Ollama entirely and return rich demo AI responses.
    # Set AI_DEMO_MODE=true in cloud deployments where Ollama is unavailable.
    ai_demo_mode: bool = False

    # ── CORS ─────────────────────────────────────────────────────────────────
    # Comma-separated list of allowed origins.
    # Example: "https://sentinel-ai.vercel.app,http://localhost:3000"
    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    # ── General ───────────────────────────────────────────────────────────────
    environment: str = "development"
    log_level: str = "INFO"

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS_ORIGINS env var into a Python list."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
