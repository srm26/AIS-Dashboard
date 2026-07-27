import json
import os

_METADATA_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "metadata.json")


def load_metadata() -> dict:
    try:
        with open(_METADATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_metadata(store: dict):
    tmp = _METADATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    os.replace(tmp, _METADATA_PATH)
