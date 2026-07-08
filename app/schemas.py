from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SubjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime
    document_count: int = 0


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject_id: int
    filename: str
    upload_status: str
    page_count: int | None
    error_message: str | None
    uploaded_at: datetime


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    explanation_mode: Literal["simple", "university"] = "university"
    top_k: int = Field(default=5, ge=1, le=8)


class CitationRead(BaseModel):
    document_id: int
    filename: str
    page_number: int
    chunk_text: str


class GenerateRequest(BaseModel):
    type: Literal["summary", "mcq", "flashcard"]
    topic: str | None = Field(default=None, max_length=300)
    count: int = Field(default=5, ge=1, le=10)


class GeneratedContentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject_id: int
    type: str
    content_json: dict
    created_at: datetime
