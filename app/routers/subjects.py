import json
import logging
from pathlib import Path
import shutil

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import STORAGE_DIR, get_db
from app.models import ChatMessage, ChatSession, Chunk, Citation, Document, GeneratedContent, Subject
from app.schemas import (
    ChatRequest,
    ChatMessageRead,
    ChatSessionRead,
    CitationRead,
    DashboardStatsRead,
    DocumentRead,
    ExamPrepRequest,
    GeneratedContentRead,
    GenerateRequest,
    SubjectCreate,
    SubjectRead,
    SubjectUpdate,
)
from app.services.export import generated_content_to_markdown, generated_content_to_pdf_bytes
from app.services.generation import generate_exam_prep_pack, generate_important_topics, generate_study_content
from app.services.indexing import delete_document_vectors, delete_subject_collection, retrieve_chunks
from app.services.llm import generate_answer
from app.services.pdf_processing import process_pdf_document


router = APIRouter(prefix="/subjects", tags=["subjects"])
logger = logging.getLogger(__name__)


@router.get("/dashboard/stats", response_model=DashboardStatsRead)
def get_dashboard_stats(db: Session = Depends(get_db)) -> DashboardStatsRead:
    return DashboardStatsRead(
        subject_count=int(db.scalar(select(func.count(Subject.id))) or 0),
        document_count=int(db.scalar(select(func.count(Document.id))) or 0),
        chat_session_count=int(db.scalar(select(func.count(ChatSession.id))) or 0),
        generated_set_count=int(db.scalar(select(func.count(GeneratedContent.id))) or 0),
    )


@router.post("", response_model=SubjectRead, status_code=status.HTTP_201_CREATED)
def create_subject(payload: SubjectCreate, db: Session = Depends(get_db)) -> SubjectRead:
    name = " ".join(payload.name.strip().split())
    if not name:
        raise HTTPException(status_code=422, detail="Subject name is required.")

    subject = Subject(name=name)
    db.add(subject)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A subject with this name already exists.") from exc

    db.refresh(subject)
    return SubjectRead.model_validate(subject).model_copy(update={"document_count": 0})


@router.get("", response_model=list[SubjectRead])
def list_subjects(db: Session = Depends(get_db)) -> list[SubjectRead]:
    statement = (
        select(Subject, func.count(Document.id).label("document_count"))
        .outerjoin(Document)
        .group_by(Subject.id)
        .order_by(Subject.created_at.desc())
    )

    subjects = []
    for subject, document_count in db.execute(statement).all():
        subjects.append(
            SubjectRead.model_validate(subject).model_copy(
                update={"document_count": int(document_count)}
            )
        )

    return subjects


@router.patch("/{subject_id}", response_model=SubjectRead)
def update_subject(
    subject_id: int,
    payload: SubjectUpdate,
    db: Session = Depends(get_db),
) -> SubjectRead:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    name = " ".join(payload.name.strip().split())
    if not name:
        raise HTTPException(status_code=400, detail="Subject name is required.")

    subject.name = name

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A subject with this name already exists.") from exc

    db.refresh(subject)
    document_count = int(
        db.scalar(select(func.count(Document.id)).where(Document.subject_id == subject_id)) or 0
    )
    return SubjectRead.model_validate(subject).model_copy(update={"document_count": document_count})


@router.delete("/{subject_id}")
def delete_subject(subject_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    document_ids = select(Document.id).where(Document.subject_id == subject_id)
    session_ids = select(ChatSession.id).where(ChatSession.subject_id == subject_id)
    message_ids = select(ChatMessage.id).where(ChatMessage.session_id.in_(session_ids))
    subject_dir = STORAGE_DIR / str(subject_id)

    try:
        delete_subject_collection(subject_id)
        delete_storage_tree(subject_dir)

        db.execute(
            delete(Citation).where(
                or_(
                    Citation.message_id.in_(message_ids),
                    Citation.document_id.in_(document_ids),
                )
            )
        )
        db.execute(delete(ChatMessage).where(ChatMessage.session_id.in_(session_ids)))
        db.execute(delete(ChatSession).where(ChatSession.subject_id == subject_id))
        db.execute(delete(GeneratedContent).where(GeneratedContent.subject_id == subject_id))
        db.execute(delete(Chunk).where(Chunk.subject_id == subject_id))
        db.execute(delete(Document).where(Document.subject_id == subject_id))
        db.execute(delete(Subject).where(Subject.id == subject_id))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception(
            "Failed to delete subject %s. Partial disk or Chroma cleanup may have already occurred.",
            subject_id,
        )
        raise HTTPException(status_code=500, detail=f"Failed to delete subject: {exc}") from exc

    return {"detail": f"Subject {subject_id} deleted successfully."}


@router.post("/{subject_id}/documents", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
async def upload_document(
    subject_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> Document:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    filename = Path(file.filename or "document.pdf").name
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported in v1.")

    document = Document(
        subject_id=subject.id,
        filename=filename,
        upload_status="processing",
        storage_path="pending",
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    subject_dir = STORAGE_DIR / str(subject.id)
    subject_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = subject_dir / f"{document.id}.pdf"
    pdf_path.write_bytes(await file.read())

    document.storage_path = str(pdf_path)
    document.upload_status = "processing"
    db.commit()
    db.refresh(document)

    background_tasks.add_task(process_pdf_document, document.id)
    return document


@router.get("/{subject_id}/documents", response_model=list[DocumentRead])
def list_documents(subject_id: int, db: Session = Depends(get_db)) -> list[Document]:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    statement = (
        select(Document)
        .where(Document.subject_id == subject_id)
        .order_by(Document.uploaded_at.desc())
    )
    return list(db.scalars(statement).all())


@router.delete("/{subject_id}/documents/{document_id}")
def delete_document(
    subject_id: int,
    document_id: int,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    document = db.get(Document, document_id)
    if document is None or document.subject_id != subject_id:
        raise HTTPException(status_code=404, detail="Document not found.")

    file_paths = [document.storage_path, document.extracted_text_path]

    try:
        delete_document_vectors(subject_id, document_id)
        for file_path in file_paths:
            delete_storage_file(file_path)

        db.execute(delete(Citation).where(Citation.document_id == document_id))
        db.execute(delete(Chunk).where(Chunk.document_id == document_id))
        db.execute(delete(Document).where(Document.id == document_id))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception(
            "Failed to delete document %s for subject %s. Partial disk or Chroma cleanup may have already occurred.",
            document_id,
            subject_id,
        )
        raise HTTPException(status_code=500, detail=f"Failed to delete document: {exc}") from exc

    return {"detail": f"Document {document_id} deleted successfully."}


@router.get("/{subject_id}/generated", response_model=list[GeneratedContentRead])
def list_generated_content(
    subject_id: int,
    db: Session = Depends(get_db),
) -> list[GeneratedContentRead]:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    statement = (
        select(GeneratedContent)
        .where(GeneratedContent.subject_id == subject_id)
        .order_by(GeneratedContent.created_at.desc(), GeneratedContent.id.desc())
    )

    return [generated_content_read(content, db) for content in db.scalars(statement).all()]


@router.delete("/{subject_id}/generated/{content_id}")
def delete_generated_content(
    subject_id: int,
    content_id: int,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    content = db.get(GeneratedContent, content_id)
    if content is None or content.subject_id != subject_id:
        raise HTTPException(status_code=404, detail="Generated content not found.")

    db.delete(content)
    db.commit()

    return {"detail": f"Generated content {content_id} deleted successfully."}


@router.get("/generated/all", response_model=list[GeneratedContentRead])
def list_all_generated_content(db: Session = Depends(get_db)) -> list[GeneratedContentRead]:
    statement = select(GeneratedContent).order_by(
        GeneratedContent.created_at.desc(),
        GeneratedContent.id.desc(),
    )

    return [generated_content_read(content, db) for content in db.scalars(statement).all()]


@router.get("/{subject_id}/export/{content_id}")
def export_generated_content(
    subject_id: int,
    content_id: int,
    format: str = "markdown",
    db: Session = Depends(get_db),
) -> Response:
    generated = db.get(GeneratedContent, content_id)
    if generated is None or generated.subject_id != subject_id:
        raise HTTPException(status_code=404, detail="Generated content not found.")

    content = json.loads(generated.content_json)
    requested_format = format.lower()
    base_filename = f"pageturn-{generated.type}-{generated.id}"

    if requested_format in {"markdown", "md"}:
        markdown = generated_content_to_markdown(content)
        return Response(
            content=markdown,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{base_filename}.md"'},
        )

    if requested_format == "pdf":
        pdf_bytes = generated_content_to_pdf_bytes(content)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{base_filename}.pdf"'},
        )

    raise HTTPException(status_code=400, detail="Export format must be markdown or pdf.")


def generated_content_read(content: GeneratedContent, db: Session) -> GeneratedContentRead:
    content_json = json.loads(content.content_json)
    enrich_topic_prediction_sources(content_json, db, content.subject_id)

    return GeneratedContentRead(
        id=content.id,
        subject_id=content.subject_id,
        type=content.type,
        content_json=content_json,
        created_at=content.created_at,
    )


def enrich_topic_prediction_sources(content_json: dict, db: Session, subject_id: int) -> None:
    if content_json.get("type") != "topic_prediction":
        return

    topics = content_json.get("topics")
    if not isinstance(topics, list):
        return

    for topic in topics:
        if not isinstance(topic, dict):
            continue

        existing_source_ids = topic.get("source_chunk_ids")
        source_ids = [
            source_id
            for source_id in existing_source_ids
            if isinstance(source_id, str)
        ] if isinstance(existing_source_ids, list) else []

        citations = topic.get("citations")
        if not isinstance(citations, list):
            topic["source_chunk_ids"] = source_ids
            continue

        for citation in citations:
            if not isinstance(citation, dict):
                continue

            chunk_id = citation.get("chunk_id")
            if not isinstance(chunk_id, int):
                chunk = find_chunk_for_citation(db, subject_id, citation)
                if chunk is None:
                    continue

                chunk_id = chunk.id
                citation["chunk_id"] = chunk_id

            source_id = f"chunk_{chunk_id}"
            if source_id not in source_ids:
                source_ids.append(source_id)

        topic["source_chunk_ids"] = source_ids


def find_chunk_for_citation(db: Session, subject_id: int, citation: dict) -> Chunk | None:
    document_id = citation.get("document_id")
    page_number = citation.get("page_number")
    if not isinstance(document_id, int) or not isinstance(page_number, int):
        return None

    statement = (
        select(Chunk)
        .where(
            Chunk.subject_id == subject_id,
            Chunk.document_id == document_id,
            Chunk.page_number == page_number,
        )
        .order_by(Chunk.chunk_index)
    )
    chunks = list(db.scalars(statement).all())
    if not chunks:
        return None

    chunk_text = citation.get("chunk_text")
    if isinstance(chunk_text, str) and chunk_text:
        for chunk in chunks:
            if chunk.content.startswith(chunk_text[:120]) or chunk_text.startswith(chunk.content[:120]):
                return chunk

    return chunks[0]


@router.get("/document-files/{document_id}")
def get_document_file(document_id: int, db: Session = Depends(get_db)) -> FileResponse:
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    pdf_path = Path(document.storage_path)
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Document file not found.")

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=document.filename,
    )


@router.post("/{subject_id}/generate", response_model=GeneratedContentRead)
def generate_content_for_subject(
    subject_id: int,
    payload: GenerateRequest,
    db: Session = Depends(get_db),
) -> GeneratedContentRead:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    content = generate_study_content(
        db=db,
        subject_id=subject_id,
        content_type=payload.type,
        topic=payload.topic,
        count=payload.count,
        selected_chunk_ids=payload.selected_chunk_ids,
    )
    generated = GeneratedContent(
        subject_id=subject_id,
        type=payload.type,
        content_json=json.dumps(content),
    )
    db.add(generated)
    db.commit()
    db.refresh(generated)

    return GeneratedContentRead(
        id=generated.id,
        subject_id=generated.subject_id,
        type=generated.type,
        content_json=content,
        created_at=generated.created_at,
    )


@router.post("/{subject_id}/predict-topics", response_model=GeneratedContentRead)
def predict_topics_for_subject(
    subject_id: int,
    db: Session = Depends(get_db),
) -> GeneratedContentRead:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    content = generate_important_topics(
        db=db,
        subject_id=subject_id,
    )
    generated = GeneratedContent(
        subject_id=subject_id,
        type="topic_prediction",
        content_json=json.dumps(content),
    )
    db.add(generated)
    db.commit()
    db.refresh(generated)

    return GeneratedContentRead(
        id=generated.id,
        subject_id=generated.subject_id,
        type=generated.type,
        content_json=content,
        created_at=generated.created_at,
    )


@router.post("/{subject_id}/exam-prep", response_model=GeneratedContentRead)
def generate_exam_prep_for_subject(
    subject_id: int,
    payload: ExamPrepRequest,
    db: Session = Depends(get_db),
) -> GeneratedContentRead:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    logger.warning(
        "Exam prep request received: subject_id=%s selected_chunk_ids=%s selected_topic_names=%s",
        subject_id,
        payload.selected_chunk_ids,
        [
            topic.get("name")
            for topic in (payload.selected_topics or [])
            if isinstance(topic, dict)
        ],
    )
    content = generate_exam_prep_pack(
        db=db,
        subject_id=subject_id,
        selected_chunk_ids=payload.selected_chunk_ids,
        selected_topics=payload.selected_topics,
    )
    generated = GeneratedContent(
        subject_id=subject_id,
        type="exam_prep",
        content_json=json.dumps(content),
    )
    db.add(generated)
    db.commit()
    db.refresh(generated)

    return GeneratedContentRead(
        id=generated.id,
        subject_id=generated.subject_id,
        type=generated.type,
        content_json=content,
        created_at=generated.created_at,
    )


@router.post("/{subject_id}/chat")
def chat_with_subject(
    subject_id: int,
    payload: ChatRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    retrieved = retrieve_chunks(db, subject_id, payload.question, payload.top_k)
    answer = generate_answer(payload.question, retrieved, payload.explanation_mode)
    citations = [] if answer.lower().startswith("not found") else build_citations(retrieved)

    if payload.session_id is None:
        session = ChatSession(subject_id=subject_id)
        db.add(session)
        db.flush()
    else:
        session = db.get(ChatSession, payload.session_id)
        if session is None or session.subject_id != subject_id:
            raise HTTPException(status_code=404, detail="Chat session not found.")

    user_message = ChatMessage(
        session_id=session.id,
        role="user",
        content=payload.question,
    )
    assistant_message = ChatMessage(
        session_id=session.id,
        role="assistant",
        content=answer,
    )
    db.add_all([user_message, assistant_message])
    db.flush()

    for citation in citations:
        db.add(
            Citation(
                message_id=assistant_message.id,
                document_id=citation.document_id,
                page_number=citation.page_number,
                chunk_text=citation.chunk_text,
            )
        )

    db.commit()

    return StreamingResponse(
        stream_chat_response(session.id, answer, citations),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{subject_id}/chat/history", response_model=list[ChatSessionRead])
def get_chat_history(
    subject_id: int,
    db: Session = Depends(get_db),
) -> list[ChatSessionRead]:
    subject = db.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found.")

    statement = (
        select(ChatSession)
        .where(ChatSession.subject_id == subject_id)
        .order_by(ChatSession.created_at.desc(), ChatSession.id.desc())
    )
    sessions = db.scalars(statement).all()

    return [build_chat_session_read(db, session) for session in sessions]


def build_citations(retrieved_chunks) -> list[CitationRead]:
    citations: list[CitationRead] = []
    seen: set[tuple[int, int]] = set()

    for item in retrieved_chunks:
        if item.score < 0.02:
            continue

        chunk = item.chunk
        key = (chunk.document_id, chunk.page_number)
        if key in seen:
            continue

        seen.add(key)
        citations.append(
            CitationRead(
                document_id=chunk.document_id,
                filename=chunk.document.filename,
                page_number=chunk.page_number,
                chunk_text=chunk.content[:700],
            )
        )

        if len(citations) >= 5:
            break

    return citations


def delete_storage_tree(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)


def delete_storage_file(path_value: str | None) -> None:
    if not path_value:
        return

    path = Path(path_value)
    if not path.exists():
        return

    storage_root = STORAGE_DIR.resolve()
    resolved_path = path.resolve()
    if storage_root != resolved_path and storage_root not in resolved_path.parents:
        raise ValueError(f"Refusing to delete file outside storage directory: {path}")

    path.unlink()


def build_chat_session_read(db: Session, session: ChatSession) -> ChatSessionRead:
    message_statement = (
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at, ChatMessage.id)
    )
    messages = []
    title = "New chat"

    for message in db.scalars(message_statement).all():
        citation_reads = [
            CitationRead(
                document_id=citation.document_id,
                filename=citation.document.filename,
                page_number=citation.page_number,
                chunk_text=citation.chunk_text,
            )
            for citation in message.citations
        ]
        if title == "New chat" and message.role == "user":
            title = message.content[:80]
        messages.append(
            ChatMessageRead(
                id=message.id,
                role=message.role,
                content=message.content,
                created_at=message.created_at,
                citations=citation_reads,
            )
        )

    return ChatSessionRead(
        id=session.id,
        subject_id=session.subject_id,
        created_at=session.created_at,
        title=title,
        messages=messages,
    )


def stream_chat_response(session_id: int, answer: str, citations: list[CitationRead]):
    yield sse_event("session", {"id": session_id})
    for token in answer.split(" "):
        yield sse_event("token", {"text": token + " "})

    yield sse_event(
        "citations",
        {"citations": [citation.model_dump() for citation in citations]},
    )
    yield sse_event("done", {"ok": True})


def sse_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"
