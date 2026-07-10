from functools import lru_cache

from sentence_transformers import SentenceTransformer


EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
MODEL_NAME = "all-MiniLM-L6-v2"


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    return SentenceTransformer(MODEL_NAME, local_files_only=True)


def embed_text(text: str) -> list[float]:
    return embed_texts([text])[0]


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    embeddings = get_embedding_model().encode(
        texts,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return embeddings.astype(float).tolist()
