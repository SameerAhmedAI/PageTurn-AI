from pathlib import Path
import json

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import STORAGE_DIR, get_db
from app.models import ChatMessage, ChatSession, Citation, Document, GeneratedContent, Subject
from app.schemas import (
    ChatRequest,
    CitationRead,
    DocumentRead,
    GeneratedContentRead,
    GenerateRequest,
    SubjectCreate,
    SubjectRead,
)
from app.services.generation import generate_study_content
from app.services.indexing import retrieve_chunks
from app.services.llm import generate_answer
from app.services.pdf_processing import process_pdf_document


router = APIRouter(prefix="/subjects", tags=["subjects"])


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

    session = ChatSession(subject_id=subject_id)
    db.add(session)
    db.flush()

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
        stream_chat_response(answer, citations),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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


def stream_chat_response(answer: str, citations: list[CitationRead]):
    for token in answer.split(" "):
        yield sse_event("token", {"text": token + " "})

    yield sse_event(
        "citations",
        {"citations": [citation.model_dump() for citation in citations]},
    )
    yield sse_event("done", {"ok": True})


def sse_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"
