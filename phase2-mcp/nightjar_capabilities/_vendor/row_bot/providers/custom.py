"""Stub of row_bot.providers.custom — provider catalog/compat is not used in Nightjar's local-only path."""
def __getattr__(name):
    raise AttributeError(name)
