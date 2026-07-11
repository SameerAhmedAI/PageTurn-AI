import json
import logging
import re

from json_repair import repair_json
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Chunk, GeneratedContent
from app.services.indexing import RetrievedChunk, retrieve_chunks
from app.services.llm import try_groq, try_ollama


logger = logging.getLogger(__name__)

SUMMARY_PROMPT_TEMPLATE = """You are PageTurn AI, a source-cited study assistant.
Use ONLY the provided chunks. Do not invent facts or citations.
Return ONLY valid JSON. Do not include markdown fences, preamble, comments, or text after the JSON.

Task:
Condense the retrieved chunks into a structured summary with headings and bullet points.
Each bullet MUST include the source_chunk_id of the chunk it came from.
If Topic is not "Entire subject", summarize ONLY that topic and ignore unrelated material even if it appears in the chunks.
{scope_instruction}

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
If Topic is not "Entire subject", write questions ONLY about that topic and ignore unrelated material even if it appears in the chunks.
{scope_instruction}

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

SHORT_ANSWER_PROMPT_TEMPLATE = """You are PageTurn AI, a source-cited exam-question writer.
Use ONLY the provided chunks. Do not invent facts, answer-guide points, or citations.
Return ONLY valid JSON. Do not include markdown fences, preamble, comments, or text after the JSON.

Task:
Generate exactly {count} short-answer/long-answer exam questions from the retrieved chunks.
Create a mix of roughly 60% "short" questions and 40% "long" questions.
Short questions should expect 1-2 sentence answers.
Long questions should expect paragraph or multi-point answers.
Each question must include an answer_guide and source_chunk_id for the chunk used.
The difficulty must be exactly "short" or "long".
If Topic is not "Entire subject", write questions ONLY about that topic and ignore unrelated material even if it appears in the chunks.
{scope_instruction}

JSON schema:
{{
  "questions": [
    {{
      "question": "string",
      "answer_guide": "string",
      "difficulty": "short",
      "source_chunk_id": "string"
    }}
  ]
}}

Topic: {topic}

Chunks:
{context}
"""

TOPIC_PREDICTION_PROMPT_TEMPLATE = """You are PageTurn AI, a source-cited exam-prep assistant.
Use ONLY the provided chunks. Do not invent facts or citations.
Return ONLY valid JSON. Do not include markdown fences, preamble, comments, or text after the JSON.

Task:
Identify the most likely-to-be-tested important topics across the entire subject.
Prefer topics that are foundational, repeated across chunks/documents, explicitly emphasized, definition-heavy, algorithmic, comparative, or likely to appear as exam questions.
Each topic MUST include source_chunk_ids for the chunks that support it.

JSON schema:
{{
  "topics": [
    {{
      "name": "string",
      "reason": "string",
      "source_chunk_ids": ["string"]
    }}
  ]
}}

Target topic count: {count}

Chunks:
{context}
"""


def generate_study_content(
    db: Session,
    subject_id: int,
    content_type: str,
    topic: str | None,
    count: int,
    selected_chunk_ids: list[int] | None = None,
) -> dict:
    if content_type == "short_answer":
        return generate_short_answer_questions(
            db=db,
            subject_id=subject_id,
            topic=topic,
            count=count,
            selected_chunk_ids=selected_chunk_ids,
        )

    retrieved = get_generation_context(db, subject_id, topic, selected_chunk_ids=selected_chunk_ids)
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


def generate_exam_prep_pack(
    db: Session,
    subject_id: int,
    selected_chunk_ids: list[int],
    selected_topics: list[dict] | None = None,
) -> dict:
    normalized_chunk_ids = sorted({chunk_id for chunk_id in selected_chunk_ids if chunk_id > 0})
    if not normalized_chunk_ids:
        raise ValueError("Exam prep generation requires at least one selected chunk.")

    logger.warning(
        "Exam prep generation scoped to selected_chunk_ids=%s for subject_id=%s",
        normalized_chunk_ids,
        subject_id,
    )
    topics_covered = normalize_selected_topics(selected_topics)
    if not topics_covered:
        topics_covered = get_topics_for_selected_chunks(db, subject_id, normalized_chunk_ids)

    focus_topic = build_exam_prep_focus_topic(topics_covered)

    try:
        summary = generate_study_content(
            db=db,
            subject_id=subject_id,
            content_type="summary",
            topic=focus_topic,
            count=6,
            selected_chunk_ids=normalized_chunk_ids,
        )
        ensure_generation_success(summary, "summary")
    except Exception as exc:
        raise RuntimeError(f"Exam prep generation failed: summary generation failed: {exc}") from exc

    try:
        mcqs = generate_study_content(
            db=db,
            subject_id=subject_id,
            content_type="mcq",
            topic=focus_topic,
            count=8,
            selected_chunk_ids=normalized_chunk_ids,
        )
        ensure_generation_success(mcqs, "MCQ")
    except Exception as exc:
        raise RuntimeError(f"Exam prep generation failed: MCQ generation failed: {exc}") from exc

    try:
        short_answer_questions = generate_short_answer_questions(
            db=db,
            subject_id=subject_id,
            topic=focus_topic,
            count=6,
            selected_chunk_ids=normalized_chunk_ids,
        )
        ensure_generation_success(short_answer_questions, "short/long question")
    except Exception as exc:
        raise RuntimeError(
            f"Exam prep generation failed: short/long question generation failed: {exc}"
        ) from exc

    return {
        "type": "exam_prep",
        "topic": None,
        "title": "Exam prep pack",
        "selected_chunk_ids": normalized_chunk_ids,
        "topics_covered": topics_covered,
        "summary": summary,
        "mcqs": mcqs,
        "short_answer_questions": short_answer_questions,
    }


def ensure_generation_success(content: dict, label: str) -> None:
    error = content.get("error")
    if isinstance(error, str) and error:
        raise RuntimeError(f"{label} generation failed: {error}")


def normalize_selected_topics(selected_topics: list[dict] | None) -> list[dict]:
    if not selected_topics:
        return []

    normalized = []
    for topic in selected_topics:
        if not isinstance(topic, dict):
            continue

        name = coerce_string(topic.get("name"), "")
        reason = coerce_string(topic.get("reason"), "")
        if not name:
            continue

        source_chunk_ids = topic.get("source_chunk_ids")
        if not isinstance(source_chunk_ids, list):
            source_chunk_ids = []

        citations = topic.get("citations")
        if not isinstance(citations, list):
            citations = []

        topic_id = topic.get("id")
        normalized.append(
            {
                "id": topic_id if isinstance(topic_id, int) else len(normalized) + 1,
                "name": name,
                "reason": reason,
                "source_chunk_ids": [
                    source_id for source_id in source_chunk_ids if isinstance(source_id, str)
                ],
                "citations": [citation for citation in citations if isinstance(citation, dict)],
            }
        )

    return normalized


def build_exam_prep_focus_topic(topics_covered: list[dict]) -> str | None:
    names = [coerce_string(topic.get("name"), "") for topic in topics_covered]
    names = [name for name in names if name]
    if not names:
        return None

    return "Selected exam prep topics: " + "; ".join(names)


def generate_short_answer_questions(
    db: Session,
    subject_id: int,
    topic: str | None = None,
    count: int = 5,
    selected_chunk_ids: list[int] | None = None,
) -> dict:
    retrieved = get_short_answer_context(
        db=db,
        subject_id=subject_id,
        topic=topic,
        selected_chunk_ids=selected_chunk_ids,
    )
    if not retrieved:
        return {
            "type": "short_answer",
            "topic": topic,
            "error": "No indexed document chunks were found for this subject.",
        }

    source_chunks = build_source_chunk_map(retrieved)
    topic_text = topic.strip() if topic and topic.strip() else "Entire subject"
    prompt = SHORT_ANSWER_PROMPT_TEMPLATE.format(
        topic=topic_text,
        count=count,
        scope_instruction=build_scope_instruction(topic_text),
        context=build_context_block(source_chunks),
    )
    raw_response = call_generation_llm(prompt)
    parsed = parse_llm_json(raw_response)
    return normalize_short_answers(topic, parsed, source_chunks, count)


def generate_important_topics(
    db: Session,
    subject_id: int,
    count: int = 8,
) -> dict:
    retrieved = get_subject_representative_context(db, subject_id)
    if not retrieved:
        return {
            "type": "topic_prediction",
            "topic": None,
            "error": "No indexed document chunks were found for this subject.",
        }

    source_chunks = build_source_chunk_map(retrieved)
    prompt = TOPIC_PREDICTION_PROMPT_TEMPLATE.format(
        count=count,
        context=build_context_block(source_chunks),
    )
    raw_response = call_generation_llm(prompt)
    parsed = parse_llm_json(raw_response)
    return normalize_important_topics(parsed, source_chunks, count)


def get_generation_context(
    db: Session,
    subject_id: int,
    topic: str | None,
    top_k: int = 8,
    selected_chunk_ids: list[int] | None = None,
) -> list[RetrievedChunk]:
    if selected_chunk_ids:
        return get_selected_chunk_context(db, subject_id, selected_chunk_ids)

    if topic and topic.strip():
        return retrieve_chunks(db, subject_id, topic.strip(), top_k)

    statement = (
        select(Chunk)
        .where(Chunk.subject_id == subject_id)
        .order_by(Chunk.document_id, Chunk.page_number, Chunk.chunk_index)
        .limit(top_k)
    )
    return [RetrievedChunk(chunk=chunk, score=1.0) for chunk in db.scalars(statement)]


def get_short_answer_context(
    db: Session,
    subject_id: int,
    topic: str | None,
    selected_chunk_ids: list[int] | None,
) -> list[RetrievedChunk]:
    if selected_chunk_ids:
        return get_selected_chunk_context(db, subject_id, selected_chunk_ids)

    if topic and topic.strip():
        return get_generation_context(db, subject_id, topic, top_k=8)

    return get_subject_representative_context(db, subject_id, max_chunks=12)


def get_selected_chunk_context(
    db: Session,
    subject_id: int,
    selected_chunk_ids: list[int],
) -> list[RetrievedChunk]:
    logger.warning(
        "Retrieving selected chunks for generation: subject_id=%s selected_chunk_ids=%s",
        subject_id,
        selected_chunk_ids,
    )
    statement = (
        select(Chunk)
        .where(Chunk.subject_id == subject_id, Chunk.id.in_(selected_chunk_ids))
        .order_by(Chunk.document_id, Chunk.page_number, Chunk.chunk_index)
    )
    chunks = list(db.scalars(statement))
    logger.warning(
        "Selected chunk retrieval returned chunk_ids=%s for subject_id=%s",
        [chunk.id for chunk in chunks],
        subject_id,
    )
    return [RetrievedChunk(chunk=chunk, score=1.0) for chunk in chunks]


def get_topics_for_selected_chunks(
    db: Session,
    subject_id: int,
    selected_chunk_ids: list[int],
) -> list[dict]:
    statement = (
        select(GeneratedContent)
        .where(
            GeneratedContent.subject_id == subject_id,
            GeneratedContent.type == "topic_prediction",
        )
        .order_by(GeneratedContent.created_at.desc(), GeneratedContent.id.desc())
        .limit(1)
    )
    generated = db.scalar(statement)
    if generated is None:
        return []

    try:
        content = json.loads(generated.content_json)
    except json.JSONDecodeError:
        logger.warning("Saved topic_prediction %s contains invalid JSON.", generated.id)
        return []

    selected_source_ids = {f"chunk_{chunk_id}" for chunk_id in selected_chunk_ids}
    covered_topics = []
    for topic in content.get("topics", []):
        if not isinstance(topic, dict):
            continue

        source_chunk_ids = topic.get("source_chunk_ids")
        if not isinstance(source_chunk_ids, list):
            continue

        topic_source_ids = {
            source_chunk_id
            for source_chunk_id in source_chunk_ids
            if isinstance(source_chunk_id, str)
        }
        if topic_source_ids.isdisjoint(selected_source_ids):
            continue

        covered_topics.append(topic)

    return covered_topics


def get_subject_representative_context(
    db: Session,
    subject_id: int,
    max_chunks: int = 24,
) -> list[RetrievedChunk]:
    statement = (
        select(Chunk)
        .where(Chunk.subject_id == subject_id)
        .order_by(Chunk.document_id, Chunk.page_number, Chunk.chunk_index)
    )
    chunks = list(db.scalars(statement).all())
    if len(chunks) <= max_chunks:
        return [RetrievedChunk(chunk=chunk, score=1.0) for chunk in chunks]

    chunks_by_document: dict[int, list[Chunk]] = {}
    for chunk in chunks:
        chunks_by_document.setdefault(chunk.document_id, []).append(chunk)

    document_ids = list(chunks_by_document.keys())
    if len(document_ids) >= max_chunks:
        sampled = [chunks_by_document[document_id][0] for document_id in document_ids[:max_chunks]]
        return [RetrievedChunk(chunk=chunk, score=1.0) for chunk in sampled]

    base_count = max_chunks // len(document_ids)
    remainder = max_chunks % len(document_ids)
    sampled_chunks: list[Chunk] = []

    for index, document_id in enumerate(document_ids):
        per_document_count = base_count + (1 if index < remainder else 0)
        sampled_chunks.extend(
            select_evenly_spaced_chunks(chunks_by_document[document_id], per_document_count)
        )

    sampled_chunks.sort(key=lambda chunk: (chunk.document_id, chunk.page_number, chunk.chunk_index))
    return [RetrievedChunk(chunk=chunk, score=1.0) for chunk in sampled_chunks[:max_chunks]]


def select_evenly_spaced_chunks(chunks: list[Chunk], count: int) -> list[Chunk]:
    if count >= len(chunks):
        return chunks

    if count <= 1:
        return [chunks[0]]

    last_index = len(chunks) - 1
    indexes = []
    for step in range(count):
        candidate = round((step * last_index) / (count - 1))
        if candidate not in indexes:
            indexes.append(candidate)

    next_index = 0
    while len(indexes) < count and next_index < len(chunks):
        if next_index not in indexes:
            indexes.append(next_index)
        next_index += 1

    return [chunks[index] for index in sorted(indexes)]


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
    scope_instruction = build_scope_instruction(topic_text)

    if content_type == "summary":
        return SUMMARY_PROMPT_TEMPLATE.format(
            topic=topic_text,
            count=count,
            scope_instruction=scope_instruction,
            context=context,
        )

    if content_type == "mcq":
        return MCQ_PROMPT_TEMPLATE.format(
            topic=topic_text,
            count=count,
            scope_instruction=scope_instruction,
            context=context,
        )

    if content_type == "flashcard":
        return FLASHCARD_PROMPT_TEMPLATE.format(topic=topic_text, count=count, context=context)

    if content_type == "short_answer":
        return SHORT_ANSWER_PROMPT_TEMPLATE.format(
            topic=topic_text,
            count=count,
            scope_instruction=scope_instruction,
            context=context,
        )

    raise ValueError(f"Unsupported generation type: {content_type}")


def build_scope_instruction(topic_text: str) -> str:
    if topic_text == "Entire subject":
        return "Scope rule: The full subject is in scope."

    return (
        "Scope rule: Treat the Topic line as the complete allowed scope. "
        "Every generated item must be directly about one of those selected topic names. "
        "If a concept appears in the chunks but is not one of the selected topics, ignore it. "
        "Before returning each question or bullet, verify that it belongs to the selected topics; "
        "discard and replace anything outside that scope."
    )


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


def normalize_short_answers(
    topic: str | None,
    parsed: dict,
    source_chunks: dict[str, Chunk],
    count: int,
) -> dict:
    questions = parsed.get("questions")
    if not isinstance(questions, list):
        raise ValueError("Short-answer JSON must include a questions array.")

    normalized_questions = []
    for question in questions[:count]:
        if not isinstance(question, dict):
            continue

        source_chunk_id = coerce_string(question.get("source_chunk_id"), "")
        citation = citation_for_source(source_chunk_id, source_chunks)
        if citation is None:
            continue

        difficulty = coerce_string(question.get("difficulty"), "short").lower()
        if difficulty not in {"short", "long"}:
            difficulty = "short"

        question_text = coerce_string(question.get("question"), "")
        answer_guide = coerce_string(question.get("answer_guide"), "")
        if not question_text or not answer_guide:
            continue

        normalized_questions.append(
            {
                "id": len(normalized_questions) + 1,
                "question": question_text,
                "answer_guide": answer_guide,
                "difficulty": difficulty,
                "citation": citation,
            }
        )

    if not normalized_questions:
        raise ValueError("Short-answer JSON did not include any usable questions.")

    return {
        "type": "short_answer",
        "topic": topic,
        "questions": normalized_questions,
    }


def normalize_important_topics(parsed: dict, source_chunks: dict[str, Chunk], count: int) -> dict:
    topics = parsed.get("topics")
    if not isinstance(topics, list):
        raise ValueError("Topic prediction JSON must include a topics array.")

    normalized_topics = []
    for topic in topics[:count]:
        if not isinstance(topic, dict):
            continue

        source_chunk_ids = topic.get("source_chunk_ids")
        if not isinstance(source_chunk_ids, list):
            source_chunk_ids = []

        citations = []
        for source_chunk_id in source_chunk_ids:
            normalized_source_chunk_id = coerce_string(source_chunk_id, "")
            if not normalized_source_chunk_id:
                continue

            citation = citation_for_source(normalized_source_chunk_id, source_chunks)
            if citation is not None:
                citations.append(citation)

        name = coerce_string(topic.get("name"), "")
        reason = coerce_string(topic.get("reason"), "")
        if not name or not reason:
            continue

        normalized_topics.append(
            {
                "id": len(normalized_topics) + 1,
                "name": name,
                "reason": reason,
                "source_chunk_ids": [
                    source_chunk_id
                    for source_chunk_id in source_chunk_ids
                    if isinstance(source_chunk_id, str) and source_chunk_id in source_chunks
                ],
                "citations": unique_citations(citations),
            }
        )

    if not normalized_topics:
        raise ValueError("Topic prediction JSON did not include any usable topics.")

    return {
        "type": "topic_prediction",
        "topic": None,
        "title": "Predicted important topics",
        "topics": normalized_topics,
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
        "chunk_id": chunk.id,
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
