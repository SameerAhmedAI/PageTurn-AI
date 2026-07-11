from __future__ import annotations

from textwrap import wrap

import fitz


def generated_content_to_markdown(content: dict) -> str:
    content_type = content.get("type", "study-set")
    topic = content.get("topic")
    title = content.get("title") or content_type.replace("_", " ").title()

    lines = [f"# {title}", ""]
    if topic:
        lines.extend([f"Topic: {topic}", ""])

    if content_type == "summary":
        for section in content.get("sections", []):
            lines.extend([f"## {section.get('heading', 'Section')}", ""])
            for bullet in section.get("bullets", []):
                lines.append(f"- {bullet}")
            lines.append("")
        append_citations(lines, content.get("citations", []))
        return "\n".join(lines).strip() + "\n"

    if content_type == "mcq":
        for question in content.get("questions", []):
            lines.extend([f"## Question {question.get('id')}", "", str(question.get("question", "")), ""])
            correct_index = question.get("correct_index")
            for index, option in enumerate(question.get("options", [])):
                marker = " (correct)" if index == correct_index else ""
                lines.append(f"- {option}{marker}")
            lines.extend(["", f"Explanation: {question.get('explanation', '')}", ""])
            append_citations(lines, [question.get("citation")])
        return "\n".join(lines).strip() + "\n"

    if content_type == "flashcard":
        for card in content.get("cards", []):
            lines.extend(
                [
                    f"## Card {card.get('id')}",
                    "",
                    f"Front: {card.get('front', '')}",
                    "",
                    f"Back: {card.get('back', '')}",
                    "",
                ]
            )
            append_citations(lines, [card.get("citation")])
        return "\n".join(lines).strip() + "\n"

    if content_type == "short_answer":
        for question in content.get("questions", []):
            difficulty = str(question.get("difficulty", "short")).title()
            lines.extend(
                [
                    f"## {difficulty} Question {question.get('id')}",
                    "",
                    str(question.get("question", "")),
                    "",
                    f"Answer guide: {question.get('answer_guide', '')}",
                    "",
                ]
            )
            append_citations(lines, [question.get("citation")])
        return "\n".join(lines).strip() + "\n"

    if content_type == "topic_prediction":
        for topic in content.get("topics", []):
            lines.extend(
                [
                    f"## {topic.get('name', 'Predicted topic')}",
                    "",
                    str(topic.get("reason", "")),
                    "",
                ]
            )
            append_citations(lines, topic.get("citations", []))
        return "\n".join(lines).strip() + "\n"

    lines.append("Unsupported generated content shape.")
    return "\n".join(lines).strip() + "\n"


def generated_content_to_pdf_bytes(content: dict) -> bytes:
    markdown = generated_content_to_markdown(content)
    doc = fitz.open()
    page = doc.new_page()
    margin = 54
    y = margin
    line_height = 15
    page_width = page.rect.width - (margin * 2)

    for raw_line in markdown.splitlines():
        if not raw_line:
            y += line_height
            continue

        font_size = 16 if raw_line.startswith("# ") else 13 if raw_line.startswith("## ") else 10.5
        font_name = "helv"
        text = raw_line.lstrip("#").strip()
        chunks = wrap(text, width=92) or [""]

        for chunk in chunks:
            if y > page.rect.height - margin:
                page = doc.new_page()
                y = margin
            page.insert_textbox(
                fitz.Rect(margin, y, margin + page_width, y + line_height + 5),
                chunk,
                fontsize=font_size,
                fontname=font_name,
                color=(0.1, 0.12, 0.16),
            )
            y += line_height + 2

        if raw_line.startswith("#"):
            y += 6

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def append_citations(lines: list[str], citations: list[dict | None]) -> None:
    valid_citations = [citation for citation in citations if citation]
    if not valid_citations:
        return

    lines.append("Sources:")
    for citation in valid_citations:
        filename = citation.get("filename", "source")
        page_number = citation.get("page_number", "?")
        lines.append(f"- {filename}, p.{page_number}")
    lines.append("")
