import logging
import os
import time

import httpx

from app.services.indexing import RetrievedChunk


logger = logging.getLogger(__name__)


def generate_answer(
    question: str,
    retrieved_chunks: list[RetrievedChunk],
    explanation_mode: str,
) -> str:
    if not retrieved_chunks or retrieved_chunks[0].score < 0.05:
        return "Not found in the provided material."

    prompt = build_prompt(question, retrieved_chunks, explanation_mode)
    answer = try_ollama(prompt) or try_groq(prompt)
    if not answer:
        raise RuntimeError(
            "Chat answer generation failed: no LLM provider returned a response. "
            "Start Ollama or set GROQ_API_KEY; extractive fallback is disabled."
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
    model = os.getenv("OLLAMA_MODEL", "qwen2.5:1.5b")

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
    except Exception as exc:
        logger.warning("Ollama LLM request failed: %s: %s", type(exc).__name__, exc)
        return None


def try_groq(prompt: str) -> str | None:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        logger.warning("Groq LLM request skipped: GROQ_API_KEY is missing or empty.")
        return None

    model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
    for attempt in range(2):
        try:
            response = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                },
                timeout=90,
            )
            response.raise_for_status()
            data = response.json()
            generated = data["choices"][0]["message"]["content"]
            return generated if isinstance(generated, str) and generated.strip() else None
        except httpx.ConnectError as exc:
            if attempt == 0:
                logger.warning(
                    "Groq LLM request connection failed; retrying once: %s: %s",
                    type(exc).__name__,
                    exc,
                )
                time.sleep(1)
                continue

            logger.warning("Groq LLM request failed: %s: %s", type(exc).__name__, exc)
            return None
        except Exception as exc:
            logger.warning("Groq LLM request failed: %s: %s", type(exc).__name__, exc)
            return None

    return None
