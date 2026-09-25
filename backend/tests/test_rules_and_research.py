"""Unit tests: the deterministic rule check, alert merging, and privacy-safe web research."""
import uuid
from datetime import date

import pytest

from app.config import Settings
from app.contracts import (ActionItem, ClinicalNote, Fact, LabResult, PatientProfile, Prescription, RecordChange,
                           RecordUpdate, SafetyAlert)
from app.orchestrator.predictions import rule_predictions
from app.orchestrator.record_update import reconcile
from app.orchestrator.research import build_queries
from app.orchestrator.safety_rules import DrugRules, merge_alerts
from app.services.real.research_tavily import TavilyResearch

TODAY = date(2026, 9, 25)


@pytest.fixture(scope="module")
def rules() -> DrugRules:
    return DrugRules.load()


def _note(*drugs: str, actions: list[ActionItem] | None = None) -> ClinicalNote:
    return ClinicalNote(summary="test", prescriptions=[Prescription(drug=d) for d in drugs],
                        action_items=actions or [])


def _profile(**facts) -> PatientProfile:
    return PatientProfile(patient_uuid=uuid.uuid4(), **facts)


def test_brand_and_generic_mapping(rules):
    assert rules.generic_name("Brufen 400 mg") == "ibuprofen"
    assert rules.generic_name("Tab. Dolo 650") == "paracetamol"
    assert rules.generic_name("Ibuprofen (Brufen)") == "ibuprofen"
    assert rules.generic_name("Augmentin 625") == "amoxicillin-clavulanate"
    assert rules.generic_name("Isosorbide mononitrate 20 mg") == "isosorbide mononitrate"
    assert rules.generic_name("Ravi") is None


def test_class_allergy_and_no_false_alarm(rules):
    allergic = _profile(allergies=[Fact(value="Penicillin", source="doctor_notes", recorded_on=date(2026, 9, 10))])
    alerts = rules.check(_note("Augmentin 625"), allergic, TODAY)
    conflict = [a for a in alerts if a.category == "allergy_conflict"]
    assert len(conflict) == 1
    assert (conflict[0].severity, conflict[0].drug) == ("critical", "amoxicillin-clavulanate")
    assert conflict[0].message.startswith("Augmentin 625 (amoxicillin-clavulanate) (a penicillin-class drug)")

    # Unrelated drugs for the same patient, and "no known allergies" facts, raise nothing.
    assert rules.check(_note("Paracetamol 650", "Azithromycin 500"), allergic, TODAY) == []
    nkda = _profile(allergies=[Fact(value="No known drug allergies", source="clinic_db")])
    assert rules.check(_note("Amoxicillin"), nkda, TODAY) == []


def test_ai_scribe_facts_never_take_precedence(rules):
    """An unreviewed AI fact still raises alerts (the safe side) but never overrides the clinic's
    record or the doctor's notes the way a doctor note does."""
    profile = _profile(allergies=[
        Fact(value="No known drug allergies", source="clinic_db", recorded_on=date(2024, 3, 2)),
        Fact(value="Penicillin", source="ai_scribe", recorded_on=date(2026, 9, 25), origin_note_id="n1")])
    alerts = rules.check(_note("Amoxicillin"), profile, TODAY)
    assert [a.category for a in alerts] == ["allergy_conflict"]            # no "takes precedence" alert
    assert "(AI scribe note, not yet reviewed, 25 Sep 2026)" in alerts[0].message


def test_reconcile_keeps_new_facts_and_drops_redundant(rules):
    profile = _profile(
        allergies=[Fact(value="No known drug allergies", source="clinic_db"),
                   Fact(value="Penicillin", source="doctor_notes")],
        active_medications=[Fact(value="Metformin 500 mg twice daily", source="clinic_db")],
        conditions=[Fact(value="Type 2 diabetes", source="clinic_db")])
    proposal = RecordUpdate(
        added=[RecordChange(category="medication", value="Tab Glycomet 500 BD"),          # brand of the same drug
               RecordChange(category="medication", value="Metformin 1000 mg twice daily"),  # dose change: new
               RecordChange(category="medication", value="Atorvastatin 10 mg at night"),
               RecordChange(category="medication", value="atorvastatin 10mg"),             # repeated in proposal
               RecordChange(category="condition", value="Diabetes"),                        # inside "Type 2 diabetes"
               RecordChange(category="condition", value="High cholesterol"),
               RecordChange(category="allergy", value="Penicillins"),                       # class alias
               RecordChange(category="allergy", value="No known allergies")],               # never recorded
        already_on_record=[RecordChange(category="allergy", value="Sulfa drugs"),          # model wrong: kept
                           RecordChange(category="condition", value="Sugar")])              # model says known
    result = reconcile(proposal, profile, rules)
    assert [(c.category, c.value) for c in result.added] == [
        ("medication", "Metformin 1000 mg twice daily"), ("medication", "Atorvastatin 10 mg at night"),
        ("condition", "High cholesterol"), ("allergy", "Sulfa drugs")]
    assert [c.value for c in result.already_on_record] == ["Tab Glycomet 500 BD", "Diabetes", "Penicillins", "Sugar"]


def test_rule_predictions_lab_trends(rules):
    def labs(*values):
        return [LabResult(name="HbA1c", value=f"{v} %", taken_on=date(2025, 1 + 2 * i, 1)) for i, v in enumerate(values)]

    [rising] = rule_predictions(_profile(labs=labs(7.0, 7.6, 8.4)), [], [], rules)
    assert rising.likelihood == "high" and "higher than 8.4 %" in rising.outcome and len(rising.evidence) == 3
    [falling] = rule_predictions(_profile(labs=labs(8.4, 7.6)), [], [], rules)
    assert falling.likelihood == "moderate" and "lower than 7.6 %" in falling.outcome
    assert rule_predictions(_profile(labs=labs(7.0, 7.1)), [], [], rules) == []    # a 1.4 % change is stable
    for p in (rising, falling):
        assert p.origin == "rule_engine" and "should" not in p.outcome


def test_interaction_within_one_prescription(rules):
    alerts = rules.check(_note("Sildenafil 50 mg", "Isosorbide mononitrate 20 mg"), _profile(), TODAY)
    assert len(alerts) == 1
    a = alerts[0]
    assert (a.category, a.severity, a.origin) == ("drug_interaction", "critical", "rule_engine")
    assert "severe hypotension" in a.message
    assert {e.source for e in a.evidence} == {"transcript", "rule_table"}


def test_monitoring_alert_skipped_when_lab_ordered(rules):
    diabetic = _profile(conditions=[Fact(value="Type 2 diabetes", source="clinic_db")],
                        labs=[LabResult(name="HbA1c", value="8.1 %", taken_on=date(2026, 1, 15))])
    alerts = rules.check(_note("Metformin 500"), diabetic, TODAY)
    assert [a.message for a in alerts] == ["Last HbA1c on record: 8.1 % on 15 Jan 2026 (253 days ago)."]
    assert alerts[0].category == "possible_omission" and alerts[0].severity == "info"

    ordered = _note("Metformin 500", actions=[ActionItem(kind="test", description="Repeat HbA1c")])
    assert rules.check(ordered, diabetic, TODAY) == []
    recent = _profile(conditions=diabetic.conditions,
                      labs=[LabResult(name="HbA1c", value="7.0 %", taken_on=date(2026, 8, 1))])
    assert rules.check(_note("Metformin 500"), recent, TODAY) == []


def test_merge_alerts_dedup_and_sort():
    rule = SafetyAlert(category="allergy_conflict", severity="critical", origin="rule_engine",
                       drug="amoxicillin", message="rule")
    info = SafetyAlert(category="history_contradiction", severity="info", origin="rule_engine", message="info")
    duplicate = SafetyAlert(category="allergy_conflict", severity="critical", origin="llm",
                            drug="amoxicillin", message="llm duplicate")
    other = SafetyAlert(category="drug_interaction", severity="warning", origin="llm",
                        drug="amoxicillin", message="llm other")
    no_drug = SafetyAlert(category="possible_omission", severity="warning", origin="llm", message="llm no drug")
    merged = merge_alerts([duplicate, other, no_drug], [info, rule])
    assert [a.message for a in merged] == ["rule", "llm other", "llm no drug", "info"]


def test_build_queries_only_vocabulary_drugs(rules):
    note = _note("Brufen 400", "Ravi", "Paracetamol", "Dolo 650", "Unknownium 10 mg", "Metformin")
    assert build_queries(note, rules, max_drugs=4) == [
        ("ibuprofen", "ibuprofen drug safety warnings interactions"),
        ("paracetamol", "paracetamol drug safety warnings interactions"),
        ("metformin", "metformin drug safety warnings interactions"),
    ]
    assert len(build_queries(note, rules, max_drugs=1)) == 1


def test_tavily_domain_filter_and_snippet_length():
    class FakeTavily:
        def __init__(self):
            self.calls = []

        def search(self, query, **kwargs):
            self.calls.append((query, kwargs))
            return {"results": [
                {"title": "Amoxicillin label", "url": "https://www.fda.gov/drugs/amoxicillin",
                 "content": "x" * 900, "published_date": "2026-01-01"},
                {"title": "Health blog", "url": "https://random-health-blog.com/amoxicillin", "content": "..."},
                {"title": "Look-alike", "url": "https://fda.gov.example.com/amoxicillin", "content": "..."},
                {"title": "MedlinePlus", "url": "https://medlineplus.gov/druginfo/meds/a685001.html",
                 "content": "short"},
                {"title": "NHS", "url": "https://www.nhs.uk/medicines/amoxicillin/", "content": "nhs"},
            ]}

    tavily = TavilyResearch(Settings(tavily_api_key="tvly-test"))
    tavily._client = FakeTavily()
    hits = tavily.search("amoxicillin drug safety warnings interactions", max_results=2)
    assert [h.domain for h in hits] == ["www.fda.gov", "medlineplus.gov"]
    assert len(hits[0].snippet) == 500
    query, kwargs = tavily._client.calls[0]
    assert query == "amoxicillin drug safety warnings interactions"
    assert kwargs["search_depth"] == "basic" and "include_answer" not in kwargs
    assert "fda.gov" in kwargs["include_domains"]
