"""Likely-outcome predictions from a patient's whole stored history.

Two sources, merged:
  - rule_predictions(): a small deterministic engine (documented reactions, lab trends,
    recurring complaints). It always runs, so the demo never depends on the LLM.
  - the LLM's predict_outcomes(), passed through screen(), which withholds any prediction
    that gives advice or cites no evidence.

Predictions describe what may happen and why, with the records they rest on. They never
recommend a test, drug, procedure or treatment, and they are never stored as records.
"""
from __future__ import annotations

import re
from datetime import date

from app.contracts import ContextChunk, Evidence, PatientProfile, Prediction, SavedNote
from app.orchestrator.safety_rules import _SOURCE_LABEL, DrugRules, _compact, _fmt

DISCLAIMER = ("Likely outcomes estimated from the stored records to support the doctor's own assessment. "
              "They are not a diagnosis, advice or a treatment recommendation.")

_LIKELIHOOD_ORDER = {"high": 0, "moderate": 1, "low": 2}
_CLASS_PLURAL = {"penicillin": "penicillin-class drugs", "sulfonamide": "sulfonamides", "nsaid": "NSAIDs",
                 "anticoagulant": "anticoagulants", "nitrate": "nitrates", "pde5_inhibitor": "PDE5 inhibitors",
                 "macrolide": "macrolides", "statin": "statins"}

# Advice or instructions: a prediction says what may happen, never what to do.
_ADVICE_IN_OUTCOME = re.compile(
    r"\b(should|recommend\w*|advis\w*|consider\w*|suggest\w*|must|ought to|needs? to|prescrib\w*|referral"
    r"|refer (?:to|the)|surgery|procedure"
    r"|(?:start|stop|increase|decrease|reduce|change|adjust|switch)(?:ing)? (?:the )?"
    r"(?:dose|dosage|medication|medicine|treatment|therapy|drug))\b", re.IGNORECASE)
_ADVICE_IN_REASONING = re.compile(
    r"\b(should|recommend\w*|suggest\w*|consider (?:start|stop|add|chang|order|refer)\w*|must|ought to"
    r"|(?:you|we) need to|advisable)\b", re.IGNORECASE)


def screen(predictions: list[Prediction]) -> tuple[list[Prediction], int]:
    """Keep LLM predictions that cite evidence and give no advice. Returns (kept, withheld)."""
    kept = [p.model_copy(update={"origin": "llm"}) for p in predictions
            if p.evidence and p.outcome.strip() and p.reasoning.strip()
            and not _ADVICE_IN_OUTCOME.search(p.outcome) and not _ADVICE_IN_REASONING.search(p.reasoning)]
    return kept, len(predictions) - len(kept)


def rank(predictions: list[Prediction]) -> list[Prediction]:
    return sorted(predictions, key=lambda p: _LIKELIHOOD_ORDER[p.likelihood])


def _number(value: str) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", value)
    return float(match.group()) if match else None


def rule_predictions(profile: PatientProfile, history: list[ContextChunk], notes: list[SavedNote],
                     rules: DrugRules) -> list[Prediction]:
    return (_documented_reactions(profile, rules) + _lab_trends(profile)
            + _recurring_complaints(history, notes))


def _documented_reactions(profile: PatientProfile, rules: DrugRules) -> list[Prediction]:
    out = []
    for fact in profile.allergies:
        if rules._is_no_allergy(fact.value):
            continue
        classes, _ = rules._allergy_scope(fact.value)
        cls = next(iter(classes), None)
        also = f" and other {_CLASS_PLURAL[cls]}" if cls in _CLASS_PLURAL else ""
        detail = f": {fact.note}" if fact.note else ""
        out.append(Prediction(
            outcome=f"An allergic reaction is likely on further exposure to {fact.value.lower()}{also}.",
            likelihood="high" if fact.note else "moderate",
            timeframe="On any future exposure",
            reasoning=(f"The {_SOURCE_LABEL[fact.source]} from {_fmt(fact.recorded_on)} records a "
                       f"{fact.value} allergy{detail}."),
            evidence=[Evidence(source=fact.source, recorded_on=fact.recorded_on,
                               snippet=f"Allergy: {fact.value}" + (f" - {fact.note}" if fact.note else ""))],
            origin="rule_engine"))
    return out


def _lab_trends(profile: PatientProfile) -> list[Prediction]:
    by_lab: dict[str, list] = {}
    for lab in profile.labs:
        if _number(lab.value) is not None:
            by_lab.setdefault(_compact(lab.name), []).append(lab)
    out = []
    for labs in by_lab.values():
        if len(labs) < 2:
            continue
        labs.sort(key=lambda lab: lab.taken_on)
        values = [_number(lab.value) for lab in labs]
        steps = [b - a for a, b in zip(values, values[1:])]
        if abs(steps[-1]) < 0.03 * abs(values[-2] or 1):          # under a 3 % change: stable
            continue
        rising = steps[-1] > 0
        consistent = all((s > 0) == rising and s != 0 for s in steps)
        name, last = labs[-1].name, labs[-1]
        out.append(Prediction(
            outcome=(f"{name} is likely to be {'higher' if rising else 'lower'} than {last.value} at the next "
                     f"test if the recent trend continues."),
            likelihood="high" if consistent and len(labs) >= 3 else "moderate",
            timeframe="Next test",
            reasoning=f"{name} went from " + " to ".join(f"{lab.value} ({_fmt(lab.taken_on)})" for lab in labs) + ".",
            evidence=[Evidence(source=lab.source, snippet=f"{lab.name}: {lab.value}", recorded_on=lab.taken_on)
                      for lab in labs],
            origin="rule_engine"))
    return out


def _recurring_complaints(history: list[ContextChunk], notes: list[SavedNote]) -> list[Prediction]:
    """A symptom from a saved consultation that also appears in records on other dates."""
    symptoms = list(dict.fromkeys(s.name.strip() for n in notes for s in n.note.symptoms if s.name.strip()))
    out = []
    for symptom in symptoms:
        pattern = re.compile(rf"\b{re.escape(symptom.lower())}\b")
        mentions = [c for c in history if c.recorded_on and pattern.search(c.text.lower())]
        dates = sorted({c.recorded_on for c in mentions})
        if len(dates) < 2:
            continue
        mentions.sort(key=lambda c: c.recorded_on, reverse=True)
        out.append(Prediction(
            outcome=f"{symptom} is likely to recur or persist.",
            likelihood="high" if len(dates) >= 3 else "moderate",
            timeframe="Coming months",
            reasoning=(f"{symptom} appears in records from {len(dates)} different dates: "
                       + ", ".join(_fmt(d) for d in dates) + "."),
            evidence=[Evidence(source=c.source, snippet=c.text, recorded_on=c.recorded_on) for c in mentions[:3]],
            origin="rule_engine"))
    return out
