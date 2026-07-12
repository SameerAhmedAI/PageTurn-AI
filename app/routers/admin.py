import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import ChatMessage, ChatSession, Citation, GeneratedContent, Subject
from app.routers.subjects import delete_subject_resources


router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)


@router.delete("/subjects/all")
def delete_all_subjects(db: Session = Depends(get_db)) -> dict[str, str | int]:
    subject_ids = list(db.scalars(select(Subject.id)).all())

    try:
        for subject_id in subject_ids:
            delete_subject_resources(subject_id, db)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception(
            "Failed to delete all subjects. Partial disk or Chroma cleanup may have already occurred."
        )
        raise HTTPException(status_code=500, detail=f"Failed to delete all subjects: {exc}") from exc

    return {
        "detail": f"Deleted {len(subject_ids)} subjects and all associated workspace data.",
        "deleted_count": len(subject_ids),
    }


@router.delete("/chats/all")
def delete_all_chats(db: Session = Depends(get_db)) -> dict[str, str | int]:
    chat_count = int(db.scalar(select(func.count(ChatSession.id))) or 0)

    try:
        db.execute(delete(Citation))
        db.execute(delete(ChatMessage))
        db.execute(delete(ChatSession))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to delete all chat history.")
        raise HTTPException(status_code=500, detail=f"Failed to delete all chat history: {exc}") from exc

    return {
        "detail": f"Deleted {chat_count} chat sessions and their messages.",
        "deleted_count": chat_count,
    }


@router.delete("/generated-content/all")
def delete_all_generated_content(db: Session = Depends(get_db)) -> dict[str, str | int]:
    generated_count = int(db.scalar(select(func.count(GeneratedContent.id))) or 0)

    try:
        db.execute(delete(GeneratedContent))
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to delete all generated study sets.")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete all generated study sets: {exc}",
        ) from exc

    return {
        "detail": f"Deleted {generated_count} generated study sets.",
        "deleted_count": generated_count,
    }
