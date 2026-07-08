import json
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Chunk, Document
from app.services.chunking import chunk_page_text
from app.services.embedding import EMBEDDING_MODEL, cosine_similarity, embed_text


@dataclass(frozen=True)
class RetrievedChunk:
    chunk: Chunk
    score: float


def index_document_chunks(
    db: Session,
    document: Document,
    page_texts: list[tuple[int, str]],
) -> int:
    db.execute(delete(Chunk).where(Chunk.document_id == document.id))

    indexed_count = 0
    for page_number, text in page_texts:
        for chunk_index, chunk_text in enumerate(chunk_page_text(text)):
            chunk = Chunk(
                subject_id=document.subject_id,
                document_id=document.id,
                page_number=page_number,
                chunk_index=chunk_index,
                content=chunk_text,
                embedding_json=json.dumps(embed_text(chunk_text)),
                embedding_model=EMBEDDING_MODEL,
            )
            db.add(chunk)
            indexed_count += 1

    return indexed_count


def retrieve_chunks(db: Session, subject_id: int, query: str, top_k: int = 5) -> list[RetrievedChunk]:
    query_embedding = embed_text(query)
    statement = select(Chunk).where(Chunk.subject_id == subject_id)

    scored: list[RetrievedChunk] = []
    for chunk in db.scalars(statement):
        embedding = json.loads(chunk.embedding_json)
        scored.append(
            RetrievedChunk(
                chunk=chunk,
                score=cosine_similarity(query_embedding, embedding),
            )
        )

    scored.sort(key=lambda item: item.score, reverse=True)
    return scored[:top_k]
