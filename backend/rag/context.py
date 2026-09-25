"""Builds what the Central Brain sees about a patient for one consult.

Two engines, one call:
  1. Safety facts (allergies, diagnoses, prescriptions) are always included, from both tiers.
  2. Hybrid search (meaning + keywords) finds past records related to today's symptoms and medicines.
"""
import re
from datetime import datetime, timezone
from statistics import median

from . import store
from .models import Conflict, Fact, Match, PatientContext

KIND = {"allergy": "allergy", "allergies": "allergy", "diagnosis": "diagnosis",
        "prescription": "prescription", "prescriptions": "prescription"}
NO_ALLERGY = re.compile(r"\b(no known|nkda|none known|no drug allerg|no allerg)", re.I)
MAX_PRESCRIPTIONS = 10
KEYWORD_BONUS = 0.05
MIN_RELATIVE_SCORE = 0.25   # tuned on the 5 demo patients: the lowest cut that still drops most filler;
                             # 0.35+ lost the HbA1c and asthma notes when the Brain gives no clinical rewording


def _text(content: str) -> str:
    """Stored chunks look like 'YYYY-MM-DD | section | text'."""
    return content.split(" | ", 2)[-1]


def _days_ago(recorded_at: str) -> int:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(recorded_at)).days


def _facts(patient_id: str) -> list[Fact]:
    facts, n_rx = [], 0
    for row in store.safety_chunks(patient_id):  # newest first
        kind = KIND[row["section"]]
        if kind == "prescription":
            n_rx += 1
            if n_rx > MAX_PRESCRIPTIONS:
                continue
        facts.append(Fact(chunk_id=row["id"], kind=kind, tier=row["tier"],
                          text=_text(row["content"]), recorded_at=row["recorded_at"][:10]))
    return facts


def find_conflicts(facts: list[Fact]) -> list[Conflict]:
    """A 'no known allergies' record next to a real allergy is flagged, never silently overridden:
    the allergy stays in the safety facts either way."""
    allergies = [f for f in facts if f.kind == "allergy"]
    none_says = [f for f in allergies if NO_ALLERGY.search(f.text)]
    real = [f for f in allergies if not NO_ALLERGY.search(f.text)]
    if not (none_says and real):
        return []
    who = {"clinic": "clinic record", "doctor": "doctor's note"}
    n, r = none_says[0], real[0]
    return [Conflict(
        topic="allergy",
        message=(f"The {who[n.tier]} ({n.recorded_at}) says '{n.text}', but the {who[r.tier]} "
                 f"({r.recorded_at}) records: '{r.text}'. Treat the allergy as present until confirmed."),
        chunk_ids=[f.chunk_id for f in none_says + real],
    )]


def get_context(patient_id: str, symptoms: list[str], medications: list[str],
                extra_queries: list[str] = (), k: int = 6) -> PatientContext:
    """symptoms / medications: English items from the Brain's first pass (not raw Kannada-English text).
    extra_queries: optional clinical rewordings from the Brain (e.g. 'polydipsia, possible hyperglycaemia'),
    which retrieve better than lay phrasing."""
    patient = store.get_patient(patient_id)
    facts = _facts(patient_id)
    fact_ids = {f.chunk_id for f in facts}

    # One hybrid search per consult item. Similarities are squashed together (0.55-0.77 on the demo data), so
    # neither an absolute cutoff nor rank fusion separates real matches from filler. Instead, score how far a
    # record stands out above that query's median result, plus a bonus for a keyword hit, and sum across items:
    # a record that several symptoms point to rises above one that matches a single word.
    fused: dict[int, Match] = {}
    queries = list(dict.fromkeys(q.strip() for q in [*symptoms, *medications, *extra_queries] if q.strip()))
    for q in queries:
        rows = store.search(patient_id, q, k=k * 2)
        if not rows:
            continue
        base = median(r["similarity"] for r in rows)
        for row in rows:
            if row["id"] in fact_ids:
                continue
            gain = max(0.0, row["similarity"] - base) + (KEYWORD_BONUS if row["keyword_rank"] > 0 else 0.0)
            m = fused.get(row["id"])
            if m is None:
                m = fused[row["id"]] = Match(
                    chunk_id=row["id"], tier=row["tier"], section=row["section"],
                    text=_text(row["content"]), recorded_at=row["recorded_at"][:10],
                    days_ago=_days_ago(row["recorded_at"]), matched_query=q,
                    similarity=round(row["similarity"], 3), score=0.0, best_gain=0.0)
            m.score += gain
            if gain > m.best_gain:
                m.best_gain, m.matched_query, m.similarity = gain, q, round(row["similarity"], 3)
    # Keep records scoring at least MIN_RELATIVE_SCORE of the best one
    ranked = sorted((m for m in fused.values() if m.score > 0), key=lambda m: m.score, reverse=True)
    relevant = [m for m in ranked if m.score >= MIN_RELATIVE_SCORE * ranked[0].score][:k] if ranked else []

    # The most recent visit always comes along, related or not
    last = store.latest_visit(patient_id)
    if last and last["id"] not in {m.chunk_id for m in relevant}:
        relevant.append(Match(chunk_id=last["id"], tier=last["tier"], section=last["section"],
                              text=_text(last["content"]), recorded_at=last["recorded_at"][:10],
                              days_ago=_days_ago(last["recorded_at"]), matched_query="(most recent visit)",
                              similarity=0.0, score=0.0))

    return PatientContext(patient_id=patient_id, display_code=patient["display_code"],
                          age=patient.get("age"), sex=patient.get("sex"),
                          safety_facts=facts, conflicts=find_conflicts(facts), relevant=relevant)


def _ago(days: int) -> str:
    if days < 45:
        return f"{days} days ago"
    if days < 548:
        return f"{round(days / 30)} months ago"
    return f"{round(days / 365)} years ago"


def format_for_llm(ctx: PatientContext) -> str:
    """Prompt block for the Central Brain. Evidence ids are H<chunk_id>; findings should cite them."""
    src = {"clinic": "clinic record", "doctor": "doctor's note"}
    lines = [f"PATIENT {ctx.display_code} · {ctx.age or '?'} {ctx.sex or ''}".rstrip(),
             "", "SAFETY FACTS (always check today's plan against these):"]
    lines += [f"  [H{f.chunk_id}] {f.recorded_at} · {src[f.tier]} · {f.kind}: {f.text}" for f in ctx.safety_facts]
    if not ctx.safety_facts:
        lines.append("  (none recorded)")
    if not any(f.kind == "allergy" for f in ctx.safety_facts):
        lines.append("  Allergy status: NEVER RECORDED (unknown, not 'none'); ask before prescribing.")
    if ctx.conflicts:
        lines += ["", "CONFLICTS BETWEEN RECORDS (do not resolve; tell the doctor):"]
        lines += [f"  - {c.message} [{', '.join(f'H{i}' for i in c.chunk_ids)}]" for c in ctx.conflicts]
    lines += ["", "PAST RECORDS RETRIEVED FOR THIS CONSULT (a search match, not a confirmed clinical link):"]
    for m in ctx.relevant:
        lines.append(f"  [H{m.chunk_id}] {m.recorded_at} ({_ago(m.days_ago)}) · {src[m.tier]} · "
                     f"{m.section}: {m.text}   <- matched on: {m.matched_query}")
    return "\n".join(lines)
