from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    checked_at: datetime


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="pageturn-api",
        version="0.1.0",
        checked_at=datetime.now(timezone.utc),
    )
