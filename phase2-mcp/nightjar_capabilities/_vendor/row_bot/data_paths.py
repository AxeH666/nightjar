"""Stub of row_bot.data_paths — returns Nightjar's data dir (was Row-Bot's brand-based dir)."""
from pathlib import Path
from nightjar_capabilities import config

def get_row_bot_data_dir() -> Path:
    config.ensure_dirs()
    return config.DATA_ROOT
