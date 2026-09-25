"""Text -> 384 numbers, locally (no text leaves the machine).

MedEmbed-small is bge-small fine-tuned for medical retrieval. On the demo data it ranked the HbA1c lab note first
for "excessive thirst", where plain bge-small ranked a common-cold note first. Same vector size, so switching
between them only needs a re-index (`python -m rag.sync`).
"""
import os
from functools import lru_cache

MODEL_NAME = os.getenv("EMBED_MODEL", "abhinand/MedEmbed-small-v0.1")
DIMENSIONS = 384

# BGE-family models expect this prefix on search queries only, never on stored text
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@lru_cache(maxsize=1)
def _model():
    import torch
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(MODEL_NAME, device="cuda" if torch.cuda.is_available() else "cpu")
    if model.get_embedding_dimension() != DIMENSIONS:
        raise RuntimeError(f"{MODEL_NAME} makes {model.get_embedding_dimension()}-number vectors; "
                           f"memory_chunks.embedding holds {DIMENSIONS}")
    return model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """For stored records."""
    return _model().encode(texts, normalize_embeddings=True).tolist()


def embed_query(text: str) -> list[float]:
    """For search questions."""
    return _model().encode(QUERY_PREFIX + text, normalize_embeddings=True).tolist()
