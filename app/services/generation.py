import json
import logging
import re

from json_repair import repair_json
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Chunk
from app.services.indexing import RetrievedChunk, retrieve_chunks
from app.services.llm import try_groq, try_ollama


logger = logging.getLogger(__name__)

SUMMARY_PROMPT_TEMPLATE = """You are PageTurn AI, a source-cited study assistant.
Use ONLY the provided chunks. Do not invent facts or citations.
Return ONLY valid JSON. Do not include markdown fences, preamble, comments, or text after the JSON.

Task:
Condense the retrieved chunks into a structured summary with headings and bullet points.
Each bullet MUST include the source_chunk_id of the chunk it came from.

JSON schema:
{{
  "title": "string",
  "sections": [
    {{
      "heading": "string",
      "bullets": [
        {{"text": "string", "source_chunk_id": "string"}}
      ]
    }}
  ]
}}

Topic: {topic}
Target bullet count: {count}

Chunks:
{context}
"""

MCQ_PROMPT_TEMPLATE = """You are PageTurn AI, a source-cited study assistant.
Use ONLY the provided chunks. Do not invent facts or citations.
Return ONLY valid JSON. Do not include markdown fences, preamble, comments, or text after the JSON.

Task:
Generate exactly {count} multiple-choice questions from the retrieved chunks.
Each question must have exactly 4 options, one correct answer, a short explanation, and source_chunk_id for the chunk used.
The correct_index must be an integer from 0 to 3.

JSON schema:
{{
  "questions": [
    {{
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correct_index": 0,
      "explanation": "string",
      "source_chunk_id": "string"
    }}
  ]
}}

Topic: {topic}

Chunks:
{context}
"""

FLASHCARD_PROMPT_TEMPLATE = """You are PageTurn AI, a source-cited study assistant.
Use ONLY the provided chunks. Do not invent facts or citations.
Return ONLY valid JSON. Do not include markdown fences, preamble, comments, or text after the JSON.

Task:
Generate exactly {count} flashcards from the retrieved chunks.
Each flashcard needs a front prompt, a back answer, and source_chunk_id for the chunk used.

JSON schema:
{{
  "cards": [
    {{
      "front": "string",
      "back": "string",
      "source_chunk_id": "string"
    }}
  ]
}}

Topic: {topic}

Chunks:
{context}
"""


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

    source_chunks = build_source_chunk_map(retrieved)
    prompt = build_generation_prompt(content_type, topic, count, source_chunks)
    raw_response = call_generation_llm(prompt)
    parsed = parse_llm_json(raw_response)

    if content_type == "summary":
        return normalize_summary(topic, parsed, source_chunks)

    if content_type == "mcq":
        return normalize_mcqs(topic, parsed, source_chunks, count)

    if content_type == "flashcard":
        return normalize_flashcards(topic, parsed, source_chunks, count)

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


def build_source_chunk_map(retrieved: list[RetrievedChunk]) -> dict[str, Chunk]:
    source_chunks: dict[str, Chunk] = {}
    for item in retrieved:
        source_chunks[get_source_chunk_id(item.chunk)] = item.chunk
    return source_chunks


def build_generation_prompt(
    content_type: str,
    topic: str | None,
    count: int,
    source_chunks: dict[str, Chunk],
) -> str:
    context = build_context_block(source_chunks)
    topic_text = topic.strip() if topic and topic.strip() else "Entire subject"

    if content_type == "summary":
        return SUMMARY_PROMPT_TEMPLATE.format(topic=topic_text, count=count, context=context)

    if content_type == "mcq":
        return MCQ_PROMPT_TEMPLATE.format(topic=topic_text, count=count, context=context)

    if content_type == "flashcard":
        return FLASHCARD_PROMPT_TEMPLATE.format(topic=topic_text, count=count, context=context)

    raise ValueError(f"Unsupported generation type: {content_type}")


def build_context_block(source_chunks: dict[str, Chunk]) -> str:
    blocks = []
    for source_chunk_id, chunk in source_chunks.items():
        blocks.append(
            "\n".join(
                [
                    f"source_chunk_id: {source_chunk_id}",
                    f"filename: {chunk.document.filename}",
                    f"page_number: {chunk.page_number}",
                    "text:",
                    chunk.content,
                ]
            )
        )
    return "\n\n---\n\n".join(blocks)


def call_generation_llm(prompt: str) -> str:
    raw_response = try_ollama(prompt) or try_groq(prompt)
    if not raw_response:
        raise RuntimeError(
            "No LLM provider returned a study-generation response. "
            "Start Ollama or set GROQ_API_KEY; deterministic extraction fallback is disabled."
        )
    return raw_response.strip()


def parse_llm_json(raw_response: str) -> dict:
    try:
        parsed = json.loads(raw_response)
    except json.JSONDecodeError:
        cleaned = strip_json_wrapping(raw_response)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            try:
                parsed = repair_json(cleaned, return_objects=True)
            except Exception as exc:
                logger.error("Study-generation LLM returned invalid JSON: %s", raw_response)
                raise ValueError("Study-generation LLM returned invalid JSON.") from exc

    if not isinstance(parsed, dict):
        logger.error("Study-generation LLM returned non-object JSON: %s", raw_response)
        raise ValueError("Study-generation LLM must return a JSON object.")

    return parsed


def strip_json_wrapping(raw_response: str) -> str:
    cleaned = raw_response.strip()
    fence_match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.DOTALL | re.IGNORECASE)
    if fence_match:
        return fence_match.group(1).strip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        return cleaned[start : end + 1]

    return cleaned


def normalize_summary(topic: str | None, parsed: dict, source_chunks: dict[str, Chunk]) -> dict:
    sections = parsed.get("sections")
    if not isinstance(sections, list):
        raise ValueError("Summary JSON must include a sections array.")

    normalized_sections = []
    citations = []

    for section in sections:
        if not isinstance(section, dict):
            continue

        heading = coerce_string(section.get("heading"), "Summary")
        bullets = []
        for bullet in section.get("bullets", []):
            if isinstance(bullet, dict):
                text = coerce_string(bullet.get("text"), "")
                source_chunk_id = coerce_string(bullet.get("source_chunk_id"), "")
            else:
                text = coerce_string(bullet, "")
                source_chunk_id = ""

            if not text:
                continue

            bullets.append(text)
            if source_chunk_id:
                citation = citation_for_source(source_chunk_id, source_chunks)
                if citation is not None:
                    citations.append(citation)

        if bullets:
            normalized_sections.append({"heading": heading, "bullets": bullets})

    if not normalized_sections:
        raise ValueError("Summary JSON did not include any usable bullets.")

    return {
        "type": "summary",
        "topic": topic,
        "title": coerce_string(parsed.get("title"), f"{topic.strip()} summary" if topic else "Subject summary"),
        "sections": normalized_sections,
        "citations": unique_citations(citations),
    }


def normalize_mcqs(
    topic: str | None,
    parsed: dict,
    source_chunks: dict[str, Chunk],
    count: int,
) -> dict:
    questions = parsed.get("questions")
    if not isinstance(questions, list):
        raise ValueError("MCQ JSON must include a questions array.")

    normalized_questions = []
    for index, question in enumerate(questions[:count], start=1):
        if not isinstance(question, dict):
            continue

        options = question.get("options")
        if not isinstance(options, list) or len(options) != 4:
            raise ValueError("Each MCQ must include exactly 4 options.")

        correct_index = question.get("correct_index")
        if not isinstance(correct_index, int) or correct_index < 0 or correct_index > 3:
            raise ValueError("Each MCQ correct_index must be an integer from 0 to 3.")

        source_chunk_id = coerce_string(question.get("source_chunk_id"), "")
        citation = citation_for_source(source_chunk_id, source_chunks)
        if citation is None:
            continue

        normalized_questions.append(
            {
                "id": len(normalized_questions) + 1,
                "question": coerce_string(question.get("question"), ""),
                "options": [coerce_string(option, "") for option in options],
                "correct_index": correct_index,
                "explanation": coerce_string(question.get("explanation"), ""),
                "citation": citation,
            }
        )

    if not normalized_questions:
        raise ValueError("MCQ JSON did not include any usable questions.")

    return {
        "type": "mcq",
        "topic": topic,
        "questions": normalized_questions,
    }


def normalize_flashcards(
    topic: str | None,
    parsed: dict,
    source_chunks: dict[str, Chunk],
    count: int,
) -> dict:
    cards = parsed.get("cards")
    if not isinstance(cards, list):
        raise ValueError("Flashcard JSON must include a cards array.")

    normalized_cards = []
    for index, card in enumerate(cards[:count], start=1):
        if not isinstance(card, dict):
            continue

        source_chunk_id = coerce_string(card.get("source_chunk_id"), "")
        citation = citation_for_source(source_chunk_id, source_chunks)
        if citation is None:
            continue

        normalized_cards.append(
            {
                "id": len(normalized_cards) + 1,
                "front": coerce_string(card.get("front"), ""),
                "back": coerce_string(card.get("back"), ""),
                "citation": citation,
                "review_state": "new",
            }
        )

    if not normalized_cards:
        raise ValueError("Flashcard JSON did not include any usable cards.")

    return {
        "type": "flashcard",
        "topic": topic,
        "cards": normalized_cards,
    }


def citation_for_source(source_chunk_id: str, source_chunks: dict[str, Chunk]) -> dict | None:
    chunk = source_chunks.get(source_chunk_id)
    if chunk is None:
        logger.warning(
            "LLM referenced unknown source_chunk_id %r. Available source_chunk_ids: %s",
            source_chunk_id,
            sorted(source_chunks.keys()),
        )
        return None
    return citation_payload(chunk)


def get_source_chunk_id(chunk: Chunk) -> str:
    return f"chunk_{chunk.id}"


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
        key = (citation["document_id"], citation["page_number"], citation["chunk_text"][:40])
        if key in seen:
            continue

        seen.add(key)
        unique.append(citation)

    return unique


def coerce_string(value, fallback: str) -> str:
    if isinstance(value, str):
        return value.strip()
    return fallback
