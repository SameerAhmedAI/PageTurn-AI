from pathlib import Path

import fitz
from sqlalchemy.orm import Session

from app.database import SessionLocal, STORAGE_DIR
from app.models import Document
from app.services.indexing import index_document_chunks


def process_pdf_document(document_id: int) -> None:
    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if document is None:
            return

        document.upload_status = "extracting"
        document.error_message = None
        db.commit()

        _extract_pdf_text(db, document)
    finally:
        db.close()


def _extract_pdf_text(db: Session, document: Document) -> None:
    pdf_path = Path(document.storage_path)
    pages: list[str] = []
    page_texts: list[tuple[int, str]] = []

    try:
        with fitz.open(pdf_path) as pdf:
            for page_index, page in enumerate(pdf, start=1):
                text = page.get_text("text").strip()
                if text:
                    page_texts.append((page_index, text))
                    pages.append(f"--- Page {page_index} ---\n{text}")

            document.page_count = pdf.page_count

        combined_text = "\n\n".join(pages).strip()
        if not combined_text:
            raise ValueError("No selectable text found. Scanned PDFs need OCR, which is deferred.")

        text_dir = STORAGE_DIR / str(document.subject_id) / "extracted"
        text_dir.mkdir(parents=True, exist_ok=True)
        text_path = text_dir / f"{document.id}.txt"
        text_path.write_text(combined_text, encoding="utf-8")

        document.extracted_text_path = str(text_path)
        document.upload_status = "chunking"
        db.commit()

        indexed_count = index_document_chunks(db, document, page_texts)
        if indexed_count == 0:
            raise ValueError("No chunks could be created from the extracted PDF text.")

        document.upload_status = "ready"
        document.error_message = None
    except Exception as exc:
        document.upload_status = "failed"
        document.error_message = str(exc)

    db.commit()
