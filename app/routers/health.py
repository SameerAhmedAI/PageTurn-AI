from datetime import datetime, timezone
import os

from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    checked_at: datetime


class LlmConfigResponse(BaseModel):
    ollama_host: str
    ollama_model: str
    groq_configured: bool
    groq_model: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="pageturn-api",
        version="0.1.0",
        checked_at=datetime.now(timezone.utc),
    )


@router.get("/settings/llm", response_model=LlmConfigResponse)
async def llm_config() -> LlmConfigResponse:
    return LlmConfigResponse(
        ollama_host=os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434"),
        ollama_model=os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b"),
        groq_configured=bool(os.getenv("GROQ_API_KEY")),
        groq_model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
    )
