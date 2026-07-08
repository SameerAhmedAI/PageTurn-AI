import re


WORD_RE = re.compile(r"\S+")


def chunk_page_text(
    text: str,
    chunk_size: int = 500,
    overlap: int = 50,
) -> list[str]:
    words = WORD_RE.findall(text)
    if not words:
        return []

    chunks: list[str] = []
    start = 0
    stride = max(1, chunk_size - overlap)

    while start < len(words):
        chunk_words = words[start : start + chunk_size]
        chunks.append(" ".join(chunk_words))
        if start + chunk_size >= len(words):
            break
        start += stride

    return chunks
