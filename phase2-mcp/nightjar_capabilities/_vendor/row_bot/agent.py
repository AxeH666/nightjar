"""Stub of row_bot.agent — only the current-thread contextvar is referenced by
the browser tool for per-thread tab isolation; default to a single thread."""
import contextvars
_current_thread_id_var = contextvars.ContextVar("nightjar_thread_id", default="default")
