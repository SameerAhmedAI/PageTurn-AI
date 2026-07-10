import json
from collections import defaultdict
from dataclasses import dataclass

import chromadb
from chromadb.api.models.Collection import Collection
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.database import DATA_DIR
from app.models import Chunk, Document
from app.services.chunking import chunk_page_text
from app.services.embedding import EMBEDDING_MODEL, embed_text, embed_texts


CHROMA_DIR = DATA_DIR / "chroma"


@dataclass(frozen=True)
class RetrievedChunk:
    chunk: Chunk
    score: float


def get_chroma_client() -> chromadb.PersistentClient:
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(CHROMA_DIR))


def get_subject_collection(subject_id: int) -> Collection:
    return get_chroma_client().get_or_create_collection(
        name=get_subject_collection_name(subject_id),
        metadata={"hnsw:space": "cosine"},
    )


def get_subject_collection_name(subject_id: int) -> str:
    return f"subject_{subject_id}"


def index_document_chunks(
    db: Session,
    document: Document,
    page_texts: list[tuple[int, str]],
) -> int:
    db.execute(delete(Chunk).where(Chunk.document_id == document.id))
    db.flush()

    collection = get_subject_collection(document.subject_id)
    collection.delete(where={"document_id": document.id})

    chunk_records: list[tuple[Chunk, str]] = []
    for page_number, text in page_texts:
        for chunk_index, chunk_text in enumerate(chunk_page_text(text)):
            chunk = Chunk(
                subject_id=document.subject_id,
                document_id=document.id,
                page_number=page_number,
                chunk_index=chunk_index,
                content=chunk_text,
                embedding_json="[]",
                embedding_model=EMBEDDING_MODEL,
            )
            db.add(chunk)
            chunk_records.append((chunk, chunk_text))

    if not chunk_records:
        return 0

    embeddings = embed_texts([chunk_text for _, chunk_text in chunk_records])
    ids = []
    documents = []
    metadatas = []

    for (chunk, chunk_text), embedding in zip(chunk_records, embeddings):
        chunk.embedding_json = json.dumps(embedding)
        ids.append(get_chunk_vector_id(chunk))
        documents.append(chunk_text)
        metadatas.append(get_chunk_metadata(chunk))

    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=documents,
        metadatas=metadatas,
    )

    return len(chunk_records)


def retrieve_chunks(db: Session, subject_id: int, query: str, top_k: int = 5) -> list[RetrievedChunk]:
    collection = get_subject_collection(subject_id)
    if collection.count() == 0 and has_sql_chunks(db, subject_id):
        migrate_chunks_to_chroma(db, subject_id=subject_id)
        collection = get_subject_collection(subject_id)

    if collection.count() == 0:
        return []

    results = collection.query(
        query_embeddings=[embed_text(query)],
        n_results=top_k,
        include=["distances", "metadatas"],
    )
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    retrieved: list[RetrievedChunk] = []
    for metadata, distance in zip(metadatas, distances):
        chunk = get_chunk_by_metadata(db, metadata)
        if chunk is None:
            continue

        score = 1.0 - float(distance or 0.0)
        retrieved.append(RetrievedChunk(chunk=chunk, score=score))

    return retrieved


def migrate_chunks_to_chroma(db: Session, subject_id: int | None = None) -> int:
    statement = select(Chunk)
    if subject_id is not None:
        statement = statement.where(Chunk.subject_id == subject_id)
    statement = statement.order_by(Chunk.subject_id, Chunk.document_id, Chunk.page_number, Chunk.chunk_index)

    chunks_by_subject: dict[int, list[Chunk]] = defaultdict(list)
    for chunk in db.scalars(statement).all():
        chunks_by_subject[chunk.subject_id].append(chunk)

    client = get_chroma_client()
    migrated_count = 0

    for current_subject_id, chunks in chunks_by_subject.items():
        collection_name = get_subject_collection_name(current_subject_id)
        try:
            client.delete_collection(collection_name)
        except Exception:
            pass

        collection = get_subject_collection(current_subject_id)
        embeddings = embed_texts([chunk.content for chunk in chunks])

        ids = []
        documents = []
        metadatas = []
        for chunk, embedding in zip(chunks, embeddings):
            chunk.embedding_json = json.dumps(embedding)
            chunk.embedding_model = EMBEDDING_MODEL
            ids.append(get_chunk_vector_id(chunk))
            documents.append(chunk.content)
            metadatas.append(get_chunk_metadata(chunk))

        collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        migrated_count += len(chunks)

    db.commit()
    return migrated_count


def has_sql_chunks(db: Session, subject_id: int) -> bool:
    count = db.scalar(select(func.count(Chunk.id)).where(Chunk.subject_id == subject_id))
    return bool(count)


def get_chunk_vector_id(chunk: Chunk) -> str:
    return f"doc_{chunk.document_id}_page_{chunk.page_number}_chunk_{chunk.chunk_index}"


def get_chunk_metadata(chunk: Chunk) -> dict:
    return {
        "subject_id": chunk.subject_id,
        "document_id": chunk.document_id,
        "page_number": chunk.page_number,
        "chunk_index": chunk.chunk_index,
    }


def get_chunk_by_metadata(db: Session, metadata: dict | None) -> Chunk | None:
    if not metadata:
        return None

    statement = select(Chunk).where(
        Chunk.document_id == int(metadata["document_id"]),
        Chunk.page_number == int(metadata["page_number"]),
        Chunk.chunk_index == int(metadata["chunk_index"]),
    )
    return db.scalar(statement)
