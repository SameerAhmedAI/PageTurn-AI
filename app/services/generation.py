import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Chunk
from app.services.indexing import RetrievedChunk, retrieve_chunks
from app.services.llm import split_statements


def generate_study_content(
    db: Session,
    subject_id: int,
    content_type: str,
    topic: str | None,
    count: int,
) -> dict:
    retrieved = get_generation_context(db, subject_id, topic)
    if not retrieved:
        return {
            "type": content_type,
            "topic": topic,
            "error": "No indexed document chunks were found for this subject.",
        }

    statements = collect_source_statements(retrieved)
    if not statements:
        return {
            "type": content_type,
            "topic": topic,
            "error": "No usable source statements were found in the retrieved chunks.",
        }

    if content_type == "summary":
        return build_summary(topic, retrieved, statements, count)

    if content_type == "mcq":
        return build_mcqs(topic, statements, count)

    if content_type == "flashcard":
        return build_flashcards(topic, statements, count)

    raise ValueError(f"Unsupported generation type: {content_type}")


def get_generation_context(
    db: Session,
    subject_id: int,
    topic: str | None,
    top_k: int = 8,
) -> list[RetrievedChunk]:
    if topic and topic.strip():
        return retrieve_chunks(db, subject_id, topic.strip(), top_k)

    statement = (
        select(Chunk)
        .where(Chunk.subject_id == subject_id)
        .order_by(Chunk.document_id, Chunk.page_number, Chunk.chunk_index)
        .limit(top_k)
    )
    return [RetrievedChunk(chunk=chunk, score=1.0) for chunk in db.scalars(statement)]


def collect_source_statements(retrieved: list[RetrievedChunk]) -> list[dict]:
    statements: list[dict] = []
    seen = set()

    for item in retrieved:
        for statement in split_statements(item.chunk.content):
            cleaned = clean_statement(statement)
            if not cleaned or cleaned in seen:
                continue

            seen.add(cleaned)
            statements.append(
                {
                    "text": cleaned,
                    "citation": citation_payload(item.chunk),
                }
            )

    return statements


def build_summary(
    topic: str | None,
    retrieved: list[RetrievedChunk],
    statements: list[dict],
    count: int,
) -> dict:
    bullets = [statement["text"] for statement in statements[: max(count, 5)]]
    citations = unique_citations([citation_payload(item.chunk) for item in retrieved])

    return {
        "type": "summary",
        "topic": topic,
        "title": f"{topic.strip()} summary" if topic else "Subject summary",
        "sections": [
            {
                "heading": "Key points from retrieved notes",
                "bullets": bullets,
            }
        ],
        "citations": citations,
    }


def build_mcqs(topic: str | None, statements: list[dict], count: int) -> dict:
    questions = []
    pool = statements[: max(count + 4, 8)]

    for index, statement in enumerate(pool[:count]):
        distractors = [
            candidate["text"]
            for candidate in pool
            if candidate["text"] != statement["text"]
        ][:3]

        while len(distractors) < 3:
            distractors.append("Not stated in the provided material.")

        options = [statement["text"], *distractors]
        questions.append(
            {
                "id": index + 1,
                "question": "Which statement is supported by the uploaded notes?",
                "options": options,
                "correct_index": 0,
                "explanation": f"The source states: {statement['text']}",
                "citation": statement["citation"],
            }
        )

    return {
        "type": "mcq",
        "topic": topic,
        "questions": questions,
    }


def build_flashcards(topic: str | None, statements: list[dict], count: int) -> dict:
    cards = []

    for index, statement in enumerate(statements[:count]):
        keyword = first_keyword(statement["text"])
        cards.append(
            {
                "id": index + 1,
                "front": f"What do the notes say about {keyword}?",
                "back": statement["text"],
                "citation": statement["citation"],
                "review_state": "new",
            }
        )

    return {
        "type": "flashcard",
        "topic": topic,
        "cards": cards,
    }


def clean_statement(statement: str) -> str:
    cleaned = " ".join(statement.split())
    if not cleaned:
        return ""

    if cleaned.startswith("%"):
        cleaned = cleaned[1:].strip()

    cleaned = cleaned.strip("- ").strip()
    cleaned = re.sub(
        r"^(facts|users|roles|assign roles to users|resources|permissions|blacklist|rules|final output|output|code):?\s+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )

    if re.fullmatch(r"[A-Za-z ]+", cleaned) and len(cleaned.split()) <= 4:
        return ""

    if len(cleaned) < 12:
        return ""

    return cleaned[:280]


def first_keyword(text: str) -> str:
    for token in text.replace("(", " ").replace(")", " ").replace(",", " ").split():
        stripped = token.strip(":-.%").lower()
        if len(stripped) > 3 and stripped not in {"rule", "users", "roles", "notes"}:
            return stripped

    return "this source point"


def citation_payload(chunk: Chunk) -> dict:
    return {
        "document_id": chunk.document_id,
        "filename": chunk.document.filename,
        "page_number": chunk.page_number,
        "chunk_text": chunk.content[:700],
    }


def unique_citations(citations: list[dict]) -> list[dict]:
    unique = []
    seen = set()

    for citation in citations:
        key = (citation["document_id"], citation["page_number"])
        if key in seen:
            continue

        seen.add(key)
        unique.append(citation)

    return unique
