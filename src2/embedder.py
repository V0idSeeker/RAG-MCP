"""
Embedder module - handles text embedding using sentence-transformers
"""
import os
import sys
from typing import List
from sentence_transformers import SentenceTransformer

# Configuration
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
# Xenova/* are ONNX ports (for the Node side) of sentence-transformers models → load the original here
MODEL_NAME = MODEL_NAME.replace("Xenova/", "sentence-transformers/")
DEVICE = os.getenv("EMBEDDING_DEVICE", "cpu")  # "cpu" or "cuda"

# Check if model uses task-specific prefixes (EmbeddingGemma style)
USE_PREFIXES = "embeddinggemma" in MODEL_NAME.lower() or "embedding-gemma" in MODEL_NAME.lower()
PREFIX_DOC = "title: none | text: "
PREFIX_QUERY = "task: search result | query: "

print(f"[Embedder] Model: {MODEL_NAME}", file=sys.stderr)
print(f"[Embedder] Device: {DEVICE}", file=sys.stderr)
print(f"[Embedder] Prefixes: {'enabled (EmbeddingGemma mode)' if USE_PREFIXES else 'disabled'}", file=sys.stderr)

# Lazy-load the model
_model = None


def get_embedder() -> SentenceTransformer:
    """Get or initialize the embedding model"""
    global _model
    if _model is None:
        print(f"[Embedder] Loading model: {MODEL_NAME}...", file=sys.stderr)
        _model = SentenceTransformer(MODEL_NAME, device=DEVICE)
        print("[Embedder] Model ready.", file=sys.stderr)
    return _model


def embed_text(text: str, text_type: str = "document") -> List[float]:
    """
    Embed a single text string
    
    Args:
        text: Text to embed
        text_type: "document" or "query" (affects prefix if USE_PREFIXES is True)
    
    Returns:
        List of floats representing the embedding vector
    """
    model = get_embedder()
    
    if USE_PREFIXES:
        prefix = PREFIX_QUERY if text_type == "query" else PREFIX_DOC
        text = prefix + text
    
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()


def embed_batch(texts: List[str], text_type: str = "document") -> List[List[float]]:
    """
    Embed a batch of texts
    
    Args:
        texts: List of texts to embed
        text_type: "document" or "query" (affects prefix if USE_PREFIXES is True)
    
    Returns:
        List of embedding vectors
    """
    model = get_embedder()
    
    if USE_PREFIXES:
        prefix = PREFIX_QUERY if text_type == "query" else PREFIX_DOC
        texts = [prefix + text for text in texts]
    
    embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=True)
    return embeddings.tolist()
