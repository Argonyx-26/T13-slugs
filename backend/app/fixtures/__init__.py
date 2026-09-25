"""Synthetic demo data: patients, scripted consultations and the drug rule table."""
import json
from pathlib import Path


def load_fixture(name: str):
    return json.loads((Path(__file__).parent / name).read_text(encoding="utf-8"))
