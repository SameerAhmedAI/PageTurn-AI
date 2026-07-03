from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import STORAGE_DIR, get_db
from app.models import Document, Subject
from app.schemas import DocumentRead, SubjectCreate, SubjectRead
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
