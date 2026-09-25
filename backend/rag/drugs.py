"""Fixed-rule drug checks against a patient's safety facts. The LLM never decides drug safety alone.

Data lives in data/drug_classes.json and data/interactions.json (demo coverage, not a clinical reference).
"""
import json
import re
from functools import lru_cache
from pathlib import Path

from .context import says_no_allergy
from .models import PatientContext

DATA = Path(__file__).parent / "data"


@lru_cache
def _tables():
    classes = json.loads((DATA / "drug_classes.json").read_text(encoding="utf-8"))
    rules = json.loads((DATA / "interactions.json").read_text(encoding="utf-8"))["rules"]
    return classes["generics"], classes["brands"], rules


def _normalise(name: str) -> str:
    name = name.lower()
    name = re.sub(r"\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu)?\b", " ", name)  # drop doses: "Augmentin 625" -> "augmentin"
    name = re.sub(r"[^a-z\- ]", " ", name)
    return re.sub(r"\s+", " ", name).strip()


def generics_of(name: str) -> list[str]:
    """'Augmentin 625' -> ['amoxicillin-clavulanate']; unknown names -> []."""
    generics, brands, _ = _tables()
    n = _normalise(name)
    candidates = [n, n.replace(" ", "-")] + n.split()
    for c in candidates:
        if c in generics:
            return [c]
        if c in brands:
            return brands[c]
    return []


def lookup_drug_class(name: str) -> list[str]:
    generics, _, _ = _tables()
    return sorted({cls for g in generics_of(name) for cls in generics[g]})


def _terms(name: str) -> set[str]:
    """Everything a medicine can be matched by: its generics and all their classes."""
    generics, _, _ = _tables()
    gs = generics_of(name)
    return set(gs) | {cls for g in gs for cls in generics[g]} | {p for g in gs for p in g.split("-")}


def _allergy_terms(text: str) -> set[str]:
    """Drugs named in an allergy record + their most specific class ('amoxicillin' -> penicillin).
    Broad classes like 'beta-lactam antibiotic' are left out so a penicillin allergy doesn't flag every cephalosporin."""
    generics, _, _ = _tables()
    out = set()
    for word in re.findall(r"[a-z\-]+", text.lower()):
        word = word.rstrip("s")                 # "penicillins" -> "penicillin"
        out.add(word)
        for g in generics_of(word):
            out |= {g, generics[g][0], *g.split("-")}
    return out


def safety_hits(medications: list[str], ctx: PatientContext) -> list[dict]:
    """Rule-based findings for today's medicines: allergy conflicts and known interactions."""
    _, _, rules = _tables()
    allergies = [f for f in ctx.safety_facts if f.kind == "allergy" and not says_no_allergy(f.text)]
    diagnoses = [f for f in ctx.safety_facts if f.kind == "diagnosis"]
    current = [f for f in ctx.safety_facts if f.kind == "prescription"]
    hits = []
    for med in medications:
        terms = _terms(med)
        if not terms:
            continue
        for f in allergies:
            shared = terms & _allergy_terms(f.text)
            if shared:
                hits.append({"kind": "allergy_conflict", "severity": "high", "medication": med,
                             "message": f"{med} ({', '.join(sorted(shared))}) conflicts with recorded allergy: {f.text}",
                             "evidence": [f.chunk_id]})
        for r in rules:
            if r["drug"] not in terms:
                continue
            if "with_condition" in r:
                ev = [f.chunk_id for f in diagnoses if r["with_condition"] in f.text.lower()]
            else:
                ev = [f.chunk_id for f in current
                      if any(r["with_drug"] in _terms(w) for w in re.findall(r"[A-Za-z\-]+", f.text))]
                if any(r["with_drug"] in _terms(other) for other in medications if other != med):
                    ev = ev or [-1]   # -1 = the clash is between two of today's medicines
            if ev:
                hits.append({"kind": "drug_interaction", "severity": r["severity"], "medication": med,
                             "message": r["message"], "evidence": ev})
    return hits
