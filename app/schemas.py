from datetime import datetime

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
