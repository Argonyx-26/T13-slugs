"""Deterministic safety check. Runs on every draft, independently of the LLM, so the key
demo alerts never depend on the model happening to notice. Alerts state facts and cite
their sources; they never give advice ("analytical assistant, not a doctor").

DEMO ONLY: the rule table (app/fixtures/drug_rules.json) is tiny, hand-made and NOT
clinically validated. A real product needs a licensed drug-interaction database.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from itertools import combinations

from app.contracts import ClinicalNote, Evidence, Fact, PatientProfile, SafetyAlert
from app.fixtures import load_fixture

_DOSE_WORDS = {"mg", "mcg", "g", "ml", "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule",
               "capsules", "syrup", "inj", "injection", "od", "bd", "tds", "sos", "hs"}
_SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}
_SOURCE_LABEL = {"clinic_db": "clinic record", "doctor_notes": "doctor note",
                 "ai_scribe": "AI scribe note, not yet reviewed"}
_CLASS_LABEL = {
    "penicillin": "a penicillin-class drug",
    "sulfonamide": "a sulfonamide",
    "nsaid": "an NSAID",
    "anticoagulant": "an anticoagulant",
    "nitrate": "a nitrate",
    "pde5_inhibitor": "a PDE5 inhibitor",
    "macrolide": "a macrolide",
    "statin": "a statin",
}


def _fmt(d: date | None) -> str:
    """date(2026, 9, 10) -> '10 Sep 2026'."""
    return d.strftime("%d %b %Y") if d else "date not recorded"


def _compact(text: str) -> str:
    """'Hb A1c' / 'HbA1c' -> 'hba1c', for matching lab names."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _named(raw: str, g: str) -> str:
    return raw if raw.lower() == g else f"{raw} ({g})"


@dataclass
class DrugRules:
    brands: dict[str, str]
    classes: dict[str, set[str]]
    class_aliases: dict[str, str]
    known: set[str]
    interactions: list[dict]
    monitoring: list[dict]
    no_allergy_phrases: set[str]

    @classmethod
    def load(cls, name: str = "drug_rules.json") -> DrugRules:
        data = load_fixture(name)
        classes = {c: {d.lower() for d in members} for c, members in data["classes"].items()}
        known = {d.lower() for d in data["other_known"]} | {d for members in classes.values() for d in members}
        return cls(
            brands={b.lower(): g.lower() for b, g in data["brands"].items()},
            classes=classes,
            class_aliases={a.lower(): c for a, c in data["class_aliases"].items()},
            known=known,
            interactions=data["interactions"],
            monitoring=data["monitoring"],
            no_allergy_phrases={p.lower() for p in data["no_allergy_phrases"]},
        )

    # ---------------------------------------------------------------- vocabulary

    def generic_name(self, raw: str) -> str | None:
        """'Brufen 400 mg' -> 'ibuprofen', 'Amoxicillin' -> 'amoxicillin', unknown -> None."""
        text = re.sub(r"\(.*?\)", " ", raw.lower())
        words = [w for w in re.findall(r"[a-z][a-z\-]*", text) if w not in _DOSE_WORDS]
        for n in (3, 2, 1):
            for i in range(len(words) - n + 1):
                candidate = " ".join(words[i:i + n])
                if candidate in self.brands:
                    return self.brands[candidate]
                if candidate in self.known:
                    return candidate
        return None

    def classes_of(self, generic: str) -> set[str]:
        return {c for c, members in self.classes.items() if generic in members}

    def _is_no_allergy(self, value: str) -> bool:
        return value.strip().lower().rstrip(".") in self.no_allergy_phrases

    def _allergy_scope(self, value: str) -> tuple[set[str], str | None]:
        """(classes the allergy covers, the allergen drug itself if it is a drug)."""
        key = value.strip().lower()
        if key in self.classes:
            return {key}, None
        if key in self.class_aliases:
            return {self.class_aliases[key]}, None
        drug = self.generic_name(value)
        if drug is None:
            return set(), None
        return self.classes_of(drug), drug

    def _interaction_rules(self, a: str, b: str) -> list[dict]:
        ca, cb = self.classes_of(a), self.classes_of(b)
        return [r for r in self.interactions
                if (r["classes"][0] in ca and r["classes"][1] in cb)
                or (r["classes"][1] in ca and r["classes"][0] in cb)]

    # ---------------------------------------------------------------- the check

    def check(self, note: ClinicalNote, profile: PatientProfile, today: date) -> list[SafetyAlert]:
        prescribed = [(p.drug, self.generic_name(p.drug)) for p in note.prescriptions]
        allergies = [f for f in profile.allergies if not self._is_no_allergy(f.value)]
        alerts = self._contradictions(profile)
        for raw, g in prescribed:
            if g:
                alerts += self._allergy_conflicts(raw, g, allergies)
                alerts += self._against_active_meds(raw, g, profile.active_medications)
        alerts += self._within_prescription(prescribed)
        alerts += self._monitoring(note, profile, today)
        return alerts

    def _contradictions(self, profile: PatientProfile) -> list[SafetyAlert]:
        """RAG_Database_Architecture.md's Contradiction Rule: a newer doctor note wins."""
        clinic_none = [f for f in profile.allergies if f.source == "clinic_db" and self._is_no_allergy(f.value)]
        noted = [f for f in profile.allergies if f.source == "doctor_notes" and not self._is_no_allergy(f.value)]
        out = []
        for old in clinic_none:
            for new in noted:
                if new.recorded_on is None or (old.recorded_on and new.recorded_on <= old.recorded_on):
                    continue
                detail = f" - {new.note}" if new.note else ""
                out.append(SafetyAlert(
                    category="history_contradiction", severity="info", origin="rule_engine",
                    message=(f"Clinic record ({_fmt(old.recorded_on)}) lists no known drug allergies, but your "
                             f"note from {_fmt(new.recorded_on)} records a {new.value} allergy. "
                             f"The more recent doctor note takes precedence."),
                    evidence=[Evidence(source="clinic_db", snippet=f"Allergies: {old.value}",
                                       recorded_on=old.recorded_on),
                              Evidence(source="doctor_notes", snippet=f"Allergy: {new.value}{detail}",
                                       recorded_on=new.recorded_on)]))
        return out

    def _allergy_conflicts(self, raw: str, g: str, allergies: list[Fact]) -> list[SafetyAlert]:
        out = []
        for fact in allergies:
            covered, allergen_drug = self._allergy_scope(fact.value)
            shared = covered & self.classes_of(g)
            if g != allergen_drug and not shared:
                continue
            cls = next(iter(shared), None)
            name = raw if raw.lower() == g else f"{raw} ({g})"
            what = f" ({_CLASS_LABEL.get(cls, cls)})" if cls else ""
            detail = f" - {fact.note}" if fact.note else ""
            out.append(SafetyAlert(
                category="allergy_conflict", severity="critical", origin="rule_engine", drug=g,
                message=(f"{name}{what} was prescribed. Patient record lists a {fact.value} allergy "
                         f"({_SOURCE_LABEL[fact.source]}, {_fmt(fact.recorded_on)})."),
                evidence=[Evidence(source=fact.source, snippet=f"Allergy: {fact.value}{detail}",
                                   recorded_on=fact.recorded_on)]))
        return out

    def _against_active_meds(self, raw: str, g: str, meds: list[Fact]) -> list[SafetyAlert]:
        out = []
        for med in meds:
            med_g = self.generic_name(med.value)
            if not med_g or med_g == g:
                continue
            for rule in self._interaction_rules(g, med_g):
                out.append(SafetyAlert(
                    category="drug_interaction", severity=rule["severity"], origin="rule_engine", drug=g,
                    message=(f"{_named(raw, g)} was prescribed. Patient record lists {med.value} as an active "
                             f"medication ({_SOURCE_LABEL[med.source]}, {_fmt(med.recorded_on)}). {rule['effect']}"),
                    evidence=[Evidence(source=med.source, snippet=f"Active medication: {med.value}",
                                       recorded_on=med.recorded_on),
                              Evidence(source="rule_table", snippet=rule["effect"])]))
        return out

    def _within_prescription(self, prescribed: list[tuple[str, str | None]]) -> list[SafetyAlert]:
        out = []
        for (raw_a, a), (raw_b, b) in combinations(prescribed, 2):
            if not a or not b or a == b:
                continue
            for rule in self._interaction_rules(a, b):
                out.append(SafetyAlert(
                    category="drug_interaction", severity=rule["severity"], origin="rule_engine", drug=b,
                    message=(f"{_named(raw_a, a)} and {_named(raw_b, b)} were both prescribed in this note. "
                             f"{rule['effect']}"),
                    evidence=[Evidence(source="transcript", snippet=f"Prescribed: {raw_a}; {raw_b}"),
                              Evidence(source="rule_table", snippet=rule["effect"])]))
        return out

    def _monitoring(self, note: ClinicalNote, profile: PatientProfile, today: date) -> list[SafetyAlert]:
        out = []
        ordered = " ".join(_compact(a.description) for a in note.action_items)
        for rule in self.monitoring:
            condition = next((c for c in profile.conditions if rule["condition"] in c.value.lower()), None)
            if condition is None or rule["lab"] in ordered:
                continue
            label = rule["label"]
            labs = [lab for lab in profile.labs if _compact(lab.name) == rule["lab"]]
            latest = max(labs, key=lambda lab: lab.taken_on, default=None)
            evidence = [Evidence(source=condition.source, snippet=f"Condition: {condition.value}",
                                 recorded_on=condition.recorded_on)]
            if latest is None:
                message = f"No {label} on record for a patient with {condition.value}."
            else:
                age = (today - latest.taken_on).days
                if age <= rule["max_age_days"]:
                    continue
                message = f"Last {label} on record: {latest.value} on {_fmt(latest.taken_on)} ({age} days ago)."
                evidence.append(Evidence(source=latest.source, snippet=f"{latest.name}: {latest.value}",
                                         recorded_on=latest.taken_on))
            evidence.append(Evidence(source="rule_table",
                                     snippet=f"{label} older than {rule['max_age_days']} days is flagged "
                                             f"for patients with {rule['condition']}."))
            out.append(SafetyAlert(category="possible_omission", severity="info", origin="rule_engine",
                                   message=message, evidence=evidence))
        return out


def merge_alerts(llm_alerts: list[SafetyAlert], rule_alerts: list[SafetyAlert]) -> list[SafetyAlert]:
    """Rule alerts win over an LLM alert about the same drug and category (they carry
    structured evidence); everything else is kept. Sorted critical -> info."""
    covered = {(a.category, a.drug) for a in rule_alerts if a.drug}
    merged = rule_alerts + [a for a in llm_alerts if not (a.drug and (a.category, a.drug) in covered)]
    return sorted(merged, key=lambda a: _SEVERITY_ORDER[a.severity])
