"""Keeps the patient record current without duplicates.

The LLM proposes the facts from a consultation note that belong in the long-term record,
split into "added" and "already_on_record". reconcile() then applies a deterministic check
on top, so the result never depends on the model alone:
  - anything that matches an existing fact (brand vs generic, dose, class alias, "diabetes"
    vs "type 2 diabetes") is moved to already_on_record;
  - an ALLERGY the model called redundant but that matches nothing is kept as added:
    missing a new allergy is far worse than recording it twice;
  - "no known allergies" is never recorded as a fact.
"""
from __future__ import annotations

import re
from datetime import date

from app.contracts import Fact, NoteFacts, PatientProfile, RecordChange, RecordUpdate
from app.orchestrator.safety_rules import DrugRules

_CATEGORY_FIELD = {"allergy": "allergies", "medication": "active_medications", "condition": "conditions"}


def without_note(profile: PatientProfile, note_id: str | None) -> PatientProfile:
    """The profile minus the facts that came from note_id (used when a note is re-processed)."""
    if note_id is None:
        return profile
    return profile.model_copy(update={field: [f for f in getattr(profile, field) if f.origin_note_id != note_id]
                                      for field in _CATEGORY_FIELD.values()})


def _words(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def _allergy_key(value: str, rules: DrugRules) -> str:
    key = value.strip().lower()
    if key in rules.class_aliases:
        return rules.class_aliases[key]
    if key in rules.classes:
        return key
    return rules.generic_name(value) or _words(value)


def _medication_key(value: str, rules: DrugRules) -> tuple[str, tuple[str, ...]]:
    words = re.findall(r"[a-z]+", value.lower())
    drug = rules.generic_name(value) or (words[0] if words else value.lower())
    return drug, tuple(re.findall(r"\d+(?:\.\d+)?", value)[:1])      # the strength, e.g. ("500",)


def _same(category: str, a: str, b: str, rules: DrugRules) -> bool:
    if category == "allergy":
        return _allergy_key(a, rules) == _allergy_key(b, rules)
    if category == "medication":
        (drug_a, dose_a), (drug_b, dose_b) = _medication_key(a, rules), _medication_key(b, rules)
        return drug_a == drug_b and (dose_a == dose_b or not dose_a or not dose_b)
    wa, wb = _words(a), _words(b)                     # condition: equal, or one contains the other
    return bool(wa and wb) and (wa == wb or f" {wa} " in f" {wb} " or f" {wb} " in f" {wa} ")


def reconcile(proposal: RecordUpdate, profile: PatientProfile, rules: DrugRules) -> RecordUpdate:
    existing = {cat: [f.value for f in getattr(profile, field)
                      if not (cat == "allergy" and rules._is_no_allergy(f.value))]
                for cat, field in _CATEGORY_FIELD.items()}
    added: list[RecordChange] = []
    known: list[RecordChange] = []
    candidates = [(c, False) for c in proposal.added] + [(c, True) for c in proposal.already_on_record]
    for change, model_says_known in candidates:
        if not change.value.strip():
            continue
        if change.category == "allergy" and rules._is_no_allergy(change.value):
            continue
        if any(_same(change.category, change.value, c.value, rules) for c in added + known
               if c.category == change.category):
            continue                                  # repeated within this proposal
        on_record = any(_same(change.category, change.value, v, rules) for v in existing[change.category])
        if on_record or (model_says_known and change.category != "allergy"):
            known.append(change)
        else:
            added.append(change)
    return RecordUpdate(added=added, already_on_record=known)


def to_note_facts(changes: list[RecordChange], *, source: str, recorded_on: date, note_id: str) -> NoteFacts:
    facts = NoteFacts()
    for c in changes:
        getattr(facts, _CATEGORY_FIELD[c.category]).append(
            Fact(value=c.value, source=source, recorded_on=recorded_on, note=c.note, origin_note_id=note_id))
    return facts
