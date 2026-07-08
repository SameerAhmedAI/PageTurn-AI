import os
import re

import httpx

from app.services.indexing import RetrievedChunk


STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "from",
    "can",
    "has",
    "in",
    "is",
    "of",
    "on",
    "or",
    "the",
    "to",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
}
TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+")


def generate_answer(
    question: str,
    retrieved_chunks: list[RetrievedChunk],
    explanation_mode: str,
) -> str:
    if not retrieved_chunks or retrieved_chunks[0].score < 0.05:
        return "Not found in the provided material."

    prompt = build_prompt(question, retrieved_chunks, explanation_mode)
    answer = try_ollama(prompt) or try_groq(prompt) or build_extractive_answer(
        question,
        retrieved_chunks,
        explanation_mode,
    )
    return answer.strip()


def build_prompt(
    question: str,
    retrieved_chunks: list[RetrievedChunk],
    explanation_mode: str,
) -> str:
    depth = (
        "Use precise university-level wording and keep the answer grounded in the source."
        if explanation_mode == "university"
        else "Use simple wording and short sentences."
    )
    context = "\n\n".join(
        f"[Source {index + 1} | page {item.chunk.page_number}]\n{item.chunk.content}"
        for index, item in enumerate(retrieved_chunks)
    )

    return f"""You are PageTurn AI, a source-cited study assistant.
Answer only from the provided context. If the context does not contain the answer, say:
"Not found in the provided material."

{depth}

Question:
{question}

Context:
{context}
"""


def try_ollama(prompt: str) -> str | None:
    host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
    model = os.getenv("OLLAMA_LLM_MODEL", "llama3.1:8b")

    try:
        response = httpx.post(
            f"{host.rstrip('/')}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
        generated = data.get("response")
        return generated if isinstance(generated, str) and generated.strip() else None
    except Exception:
        return None


def try_groq(prompt: str) -> str | None:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return None

    model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
    try:
        response = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
            },
            timeout=25,
        )
        response.raise_for_status()
        data = response.json()
        generated = data["choices"][0]["message"]["content"]
        return generated if isinstance(generated, str) and generated.strip() else None
    except Exception:
        return None


def build_extractive_answer(
    question: str,
    retrieved_chunks: list[RetrievedChunk],
    explanation_mode: str,
) -> str:
    question_terms = {
        token
        for token in TOKEN_RE.findall(question.lower())
        if token not in STOPWORDS and len(token) > 2
    }
    scored_statements: list[tuple[int, str]] = []

    for item in retrieved_chunks:
        statements = split_statements(item.chunk.content)
        for statement in statements:
            normalized = statement.lower()
            score = sum(1 for term in question_terms if term in normalized)
            if score > 0:
                scored_statements.append((score, statement))

    scored_statements.sort(key=lambda item: item[0], reverse=True)
    selected_lines = []
    seen = set()
    minimum_score = 2 if scored_statements and scored_statements[0][0] >= 2 else 1
    for score, statement in scored_statements:
        if score < minimum_score:
            continue
        if statement in seen:
            continue
        seen.add(statement)
        selected_lines.append(statement)
        if len(selected_lines) >= 5:
            break

    if not selected_lines:
        if retrieved_chunks[0].score < 0.12:
            return "Not found in the provided material."
        selected_lines = [retrieved_chunks[0].chunk.content[:700].strip()]

    prefix = (
        "From the retrieved material:"
        if explanation_mode == "university"
        else "The notes say:"
    )
    bullets = "\n".join(f"- {line}" for line in selected_lines if line)
    return f"{prefix}\n{bullets}"


def split_statements(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=\.)\s+|(?=%\s+)", text)
    return [part.strip() for part in parts if part.strip()]
