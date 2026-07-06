"""Stub of row_bot.documents — supplies the embedding model to knowledge_graph.
Replaces Row-Bot's HuggingFace/torch/LangChain-FAISS document stack with the
local Ollama embedder (only the embedding seam is needed by the memory engine)."""
from nightjar_capabilities.embeddings import OllamaEmbedder

_embedder = None

def get_embedding_model():
    global _embedder
    if _embedder is None:
        _embedder = OllamaEmbedder()
    return _embedder
