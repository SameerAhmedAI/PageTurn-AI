from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    page_number: Mapped[int] = mapped_column(Integer, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    embedding_json: Mapped[str] = mapped_column(Text)
    embedding_model: Mapped[str] = mapped_column(default="sentence-transformers/all-MiniLM-L6-v2")

    document: Mapped["Document"] = relationship()
    subject: Mapped["Subject"] = relationship()
