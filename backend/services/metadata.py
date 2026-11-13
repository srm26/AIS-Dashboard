import json
import os

from config import settings

_METADATA_PATH = os.path.join(settings.data_dir, "metadata.json")


def load_metadata() -> dict:
    try:
        with open(_METADATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_metadata(store: dict):
    os.makedirs(settings.data_dir, exist_ok=True)
    tmp = _METADATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    os.replace(tmp, _METADATA_PATH)
