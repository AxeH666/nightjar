"""Stub of row_bot.wiki_vault — the optional markdown-vault fallback is disabled.
Memory recall works from SQLite + FAISS + graph without it."""
def search(*args, **kwargs):
    return []
def save(*args, **kwargs):
    return None
def is_available(*args, **kwargs) -> bool:
    return False
