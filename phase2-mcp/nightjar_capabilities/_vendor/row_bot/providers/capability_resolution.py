"""Stub of row_bot.providers.capability_resolution — provider catalog/compat is not used in Nightjar's local-only path."""
def __getattr__(name):
    raise AttributeError(name)
