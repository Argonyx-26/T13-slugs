"""End-to-end checks for the memory layer against the seeded demo patients.

    cd backend && python -m rag.check_scenarios              # all checks
    cd backend && python -m rag.check_scenarios --show P-004 # also print the block the LLM will see

The login checks need `python -m rag.setup_users` first and DEMO_USER_PASSWORD in backend/.env; without them
they are skipped, not failed.
"""
import os
import sys
import uuid
from datetime import date

from . import reception, risk, store
from .context import UNKNOWN_ALLERGY, format_for_llm, get_context, says_no_allergy
from .db import service as sb
from .demo_data import PATIENTS
from .drugs import safety_hits
from .models import Fact, Match, PatientContext, Vitals
from .setup_users import USERS

EXPECT = {
    "P-001": {"fact": "asthma", "relevant": "beta-blockers", "hit": "drug_interaction", "risk": "low"},
    "P-002": {"conflict": True, "hit": "allergy_conflict", "risk": "low"},
    "P-003": {"fact": "warfarin", "relevant": "nsaids", "hit": "drug_interaction", "risk": "low"},
    "P-004": {"relevant": "hba1c", "risk": "medium",
              "findings": ["Possible high blood sugar", "High blood sugar", "hypertension", "Weight loss"]},
    "P-005": {"conflict": False, "no_hits": True, "risk": "low"},
    "P-006": {"fact": "diabetes", "risk": "critical", "findings": ["Possible sepsis", "NEWS2"]},
}
results: list[bool] = []


def check(label: str, ok: bool, detail: str = ""):
    results.append(ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  -> ' + detail if detail else ''}")


def _rank(ctx, needle: str) -> int | None:
    return next((i + 1 for i, m in enumerate(ctx.relevant) if needle in m.text.lower()), None)


def scenarios(ids: dict[str, str], show: set[str]):
    for p in PATIENTS:
        code, exp, c = p["code"], EXPECT[p["code"]], p["consult"]
        print(f"\n{code}: {p['story']}")
        ctx = get_context(ids[code], c["symptoms"], c["medications"], extra_queries=c["clinical"])
        hits = safety_hits(c["medications"], ctx)
        if "fact" in exp:
            check(f"safety facts mention '{exp['fact']}'", any(exp["fact"] in f.text.lower() for f in ctx.safety_facts))
        if "relevant" in exp:
            rank = _rank(ctx, exp["relevant"])
            check(f"retrieved a record mentioning '{exp['relevant']}'", rank is not None,
                  f"rank {rank} of {len(ctx.relevant)}" if rank else "not retrieved")
            lay = _rank(get_context(ids[code], c["symptoms"], c["medications"]), exp["relevant"])
            print(f"  info  without the clinical rewording: {f'rank {lay}' if lay else 'not retrieved'}")
        if "conflict" in exp:
            check(f"allergy conflict {'flagged' if exp['conflict'] else 'absent'}", bool(ctx.conflicts) == exp["conflict"],
                  ctx.conflicts[0].message if ctx.conflicts else "")
        if "hit" in exp:
            found = [h for h in hits if h["kind"] == exp["hit"]]
            check(f"rule check raises {exp['hit']}", bool(found), found[0]["message"] if found else "")
        if exp.get("no_hits"):
            check("rule check raises nothing", not hits, "; ".join(h["message"] for h in hits))
        a = risk.assess_patient(ids[code], c["symptoms"], stage="consult", vitals=Vitals(**c["vitals"]), ctx=ctx,
                                save=False)
        check(f"risk level is {exp['risk']}", a.level == exp["risk"],
              f"{a.level}: " + "; ".join(f.title for f in a.findings))
        for title in exp.get("findings", []):
            check(f"risk finding '{title}'", any(title in f.title for f in a.findings))
        if code in show:
            print("\n" + format_for_llm(ctx) + "\n\n" + risk.format_for_llm(a) + "\n")


def doctor_tier(pid: str):
    print("\nDoctor notes: draft -> approve -> clear (P-005)")
    marker = "zebra-stripe rash on left forearm"          # a phrase no seeded record contains
    found = lambda: any(marker in r["content"] for r in store.search(pid, marker, k=3))
    note = store.save_draft_note(pid, {"symptoms": [marker]})
    try:
        check("draft note is NOT searchable", not found())
        approved = store.approve_note(note["id"], approved_by="check_scenarios")
        check("approved note IS searchable", found())
        check("approval records who signed it off", approved["approved_by"] == "check_scenarios")
        try:
            store.approve_note(note["id"], approved_by="check_scenarios")
            check("an approved note can't be approved again", False, "it succeeded!")
        except ValueError:
            check("an approved note can't be approved again", True)
        removed = store.clear_doctor_memory(pid)
        check("clear_doctor_memory removes the doctor's notes", removed >= 1 and not found(), f"{removed} removed")
        clinic_left = sb.table("memory_chunks").select("id").eq("patient_id", pid).eq("tier", "clinic").execute().data
        check("...and leaves the clinic records indexed", len(clinic_left) > 0, f"{len(clinic_left)} clinic chunks")
    finally:
        store.delete_doctor_note(note["id"])


def clinic_tier(pid: str):
    print("\nClinic tier is protected")
    for verb, call in [("update", lambda: sb.table("clinic_records").update({"content": "tampered"}).eq("patient_id", pid).execute()),
                       ("delete", lambda: sb.table("clinic_records").delete().eq("patient_id", pid).execute()),
                       ("delete patients", lambda: sb.table("patients").delete().eq("id", pid).execute())]:
        try:
            call()
            check(f"backend key cannot {verb}", False, "it succeeded!")
        except Exception as e:
            check(f"backend key cannot {verb}", "permission denied" in str(e), str(e)[:70])
    store.hide_patient(pid)
    hidden = pid not in {p["id"] for p in store.list_patients()}
    store.unhide_patient(pid)
    check("doctor's delete only hides the patient, and Undo brings them back",
          hidden and pid in {p["id"] for p in store.list_patients()})


def receptionist_delete():
    print("\nOnly a receptionist can delete a patient")
    password = os.getenv("DEMO_USER_PASSWORD")
    if not password:
        print("  SKIP  set DEMO_USER_PASSWORD (see rag/setup_users.py) to run these")
        return
    doctor, reception = (store.login(email, password) for email in USERS)
    temp = sb.table("patients").insert({"display_code": f"P-TEST-{uuid.uuid4().hex[:6]}"}).execute().data[0]
    try:
        store.receptionist_delete_patient(doctor["token"], temp["id"])
        check("doctor's login is refused", False, "delete succeeded!")
    except Exception as e:
        check("doctor's login is refused", "Only a receptionist" in str(e), str(e)[:70])
    store.receptionist_delete_patient(reception["token"], temp["id"])
    gone = not sb.table("patients").select("id").eq("id", temp["id"]).execute().data
    check("receptionist's login deletes the patient", gone)
    audit = (sb.table("audit_log").select("actor").eq("action", "patient_deleted")
             .eq("patient_code", temp["display_code"]).execute().data)
    check("...and the deletion is in the audit log with who did it",
          [a["actor"] for a in audit] == ["reception@lumen.test"], str(audit))


def reception_desk():
    """A paper-register clinic's first patients. Uses a queue day in 2000 so today's real queue is untouched."""
    print("\nReception desk: registration is where a patient enters the database")
    password = os.getenv("DEMO_USER_PASSWORD")
    if not password:
        print("  SKIP  set DEMO_USER_PASSWORD: the test patients can only be removed with the receptionist's login")
        return
    day, tag = date(2000, 1, 1), uuid.uuid4().hex[:6]
    name, phone = f"Testname {tag}", f"90000{uuid.uuid4().int % 100000:05d}"
    first = reception.register_patient(name, f"+91 {phone}", 41, "F", allergies=["sulfa drugs"],
                                       conditions=["Type 2 diabetes"], medications=["Metformin 500 mg twice daily"],
                                       visit_day=day)
    second = reception.register_patient(f"Testname {tag} two", None, 30, "M", visit_day=day)
    pid, pid2 = first["patient"]["id"], second["patient"]["id"]
    try:
        check("new patient gets a P-number and a token", first["patient"]["display_code"].startswith("P-")
              and second["visit"]["token"] == first["visit"]["token"] + 1,
              f"{first['patient']['display_code']} token {first['visit']['token']}")
        check("search by phone finds them", pid in {p["patient_id"] for p in reception.search_patients(phone[-6:])})
        check("checking in again keeps the same token",
              reception.check_in(pid, day)["token"] == first["visit"]["token"])
        ctx = get_context(pid, ["frequent urination"], ["Septran"])
        check("desk-reported allergy is a safety fact from day one",
              any("sulfa" in f.text for f in ctx.safety_facts if f.kind == "allergy"))
        chunks = sb.table("memory_chunks").select("content").eq("patient_id", pid).execute().data
        check("name never reaches the search index", len(chunks) == 3 and not any(tag in c["content"] for c in chunks),
              f"{len(chunks)} chunks")
        block = format_for_llm(get_context(pid2, ["cough"], []))
        check("blank allergies read as unknown, not 'none'", "NEVER RECORDED" in block and tag not in block)

        try:
            reception.register_patient(name.upper(), phone, 41, "F")
            check("registering the same person again is caught", False, "a second P-number was created!")
        except reception.PossibleDuplicate as e:
            check("registering the same person again is caught", pid in {m["patient_id"] for m in e.matches},
                  ", ".join(f"{m['display_code']} ({m['reason']})" for m in e.matches))

        sb.table("memory_chunks").delete().eq("patient_id", pid).execute()      # as if indexing had failed
        ctx = get_context(pid, ["frequent urination"], ["Septran"])
        check("a record saved but never indexed still reaches the safety facts",
              any("sulfa" in f.text for f in ctx.safety_facts if f.kind == "allergy"))

        recs = {r["record_type"]: r for r in sb.table("clinic_records").select("*").eq("patient_id", pid).execute().data}
        try:
            store.retract_clinic_record(recs["allergy"]["id"], "stopped", by="check_scenarios")
            check("only a prescription can be marked stopped", False, "an allergy was 'stopped'!")
        except Exception as e:
            check("only a prescription can be marked stopped", "Only a prescription" in str(e), str(e)[:70])
        store.retract_clinic_record(recs["prescription"]["id"], "stopped", by="check_scenarios")
        store.retract_clinic_record(recs["allergy"]["id"], "entered_in_error", by="check_scenarios",
                                    note="patient meant a food intolerance")
        ctx = get_context(pid, ["frequent urination"], ["Septran"])
        check("a stopped prescription and a wrong allergy leave the safety facts",
              not any(f.kind in ("allergy", "prescription") for f in ctx.safety_facts)
              and any(f.kind == "diagnosis" for f in ctx.safety_facts))
        check("...but stay in the clinic records",
              len(sb.table("clinic_records").select("id").eq("patient_id", pid).execute().data) == 3)
        audit = (sb.table("audit_log").select("detail").eq("action", "record_retracted")
                 .eq("patient_code", first["patient"]["display_code"]).execute().data)
        check("...and both retractions are in the audit log", len(audit) == 2, f"{len(audit)} rows")
        _triage(day, first["visit"], second["visit"])
        check("marking seen", reception.mark_visit_seen(second["visit"]["id"])
              and [v["status"] for v in reception.visit_queue(day) if v["patient_id"] == pid2] == ["seen"])
    finally:
        token = store.login(next(e for e, r in USERS.items() if r == "receptionist"), password)["token"]
        for p in (pid, pid2):
            store.receptionist_delete_patient(token, p)


def allergy_wording():
    """How allergy text is read (no database needed)."""
    print("\nAllergy wording")
    check("'Penicillin (rash); no known food allergies' is a real allergy",
          not says_no_allergy("Penicillin (rash); no known food allergies"))
    check("'Denies drug allergies' and 'NKDA' mean none",
          says_no_allergy("Denies drug allergies") and says_no_allergy("NKDA"))
    check("'None mentioned' is left out as unknown", bool(UNKNOWN_ALLERGY.match("None mentioned.")))
    check("'Allergic to an unknown antibiotic' is kept", not UNKNOWN_ALLERGY.match("Allergic to an unknown antibiotic"))


def risk_rules():
    """The risk engine on hand-made cases (no database needed)."""
    print("\nRisk engine rules")
    normal = dict(resp_rate=16, spo2=98, systolic_bp=120, diastolic_bp=78, heart_rate=72, temperature_c=36.8,
                  consciousness="alert")
    n = risk.news2(Vitals(**normal))
    check("normal vital signs: NEWS2 0, low", n.score == 0 and n.band == "low" and not n.missing)
    n = risk.news2(Vitals(resp_rate=24, spo2=93, systolic_bp=105, heart_rate=115, temperature_c=38.5,
                          consciousness="alert"))
    check("textbook deterioration: NEWS2 8, high band", n.score == 8 and n.band == "high", f"{n.score} {n.points}")
    a = risk.assess([], Vitals(**{**normal, "spo2": 90}))
    check("one vital in the danger range (+3) -> medium", a.level == "medium", a.findings[0].title if a.findings else "")
    check("101.3 °F is read as 38.5 °C", Vitals(temperature_c=101.3).temperature_c == 38.5)
    check("missing vitals are reported, never assumed normal",
          any("Not measured" in g for g in risk.assess([], Vitals(systolic_bp=120)).gaps))

    a = risk.assess(["fever and chills"], Vitals(**{**normal, "resp_rate": 24, "systolic_bp": 96, "temperature_c": 38.6}))
    check("fever + fast breathing + low BP -> possible sepsis, critical",
          a.level == "critical" and any(f.title == "Possible sepsis" for f in a.findings))

    warfarin = Fact(chunk_id=7, kind="prescription", tier="clinic", text="Warfarin 5 mg once daily (long-term).",
                    recorded_at="2026-07-01")
    on_warfarin = PatientContext(patient_id="x", display_code="P-X", age=67, sex="M", safety_facts=[warfarin],
                                 conflicts=[], relevant=[])
    a = risk.assess(["black stools for two days"], None, on_warfarin)
    check("black stools on warfarin -> critical, citing the prescription",
          a.level == "critical" and a.findings[0].evidence == [7], "; ".join(a.findings[0].reasons))
    check("...the same symptom with no blood thinner -> high", risk.assess(["black stools"], None).level == "high")
    check("'no chest pain' does not fire a chest-pain rule",
          not any("heart" in f.title for f in risk.assess(["no chest pain", "cough"], None).findings))
    check("chest pain with sweating -> critical", risk.assess(["chest pain", "sweating"], None).level == "critical")
    check("chest pain alone -> high", risk.assess(["chest pain"], None).level == "high")

    hba1c = Match(chunk_id=9, tier="clinic", section="lab", text="HbA1c 6.2% (borderline, prediabetic range).",
                  recorded_at="2026-03-01", days_ago=200, matched_query="thirst", similarity=0.7, score=0.1)
    ctx = PatientContext(patient_id="x", display_code="P-X", age=52, sex="F", safety_facts=[], conflicts=[],
                         relevant=[hba1c])
    a = risk.assess(["excessive thirst", "frequent urination at night"], None, ctx)
    f = next((f for f in a.findings if "blood sugar" in f.title), None)
    check("thirst + urination + an old borderline HbA1c -> early diabetes risk citing the lab",
          f is not None and f.evidence == [9], "; ".join(f.reasons) if f else "")

    history = [("2025-06-01T09:00:00+00:00", Vitals(systolic_bp=128, diastolic_bp=82)),
               ("2026-01-10T09:00:00+00:00", Vitals(systolic_bp=136, diastolic_bp=86))]
    a = risk.assess([], Vitals(**{**normal, "systolic_bp": 148, "diastolic_bp": 94}), readings=history)
    check("blood pressure rising over three visits -> hypertension risk",
          any("hypertension" in f.title for f in a.findings))
    check("blood sugar 45 mg/dL -> critical", risk.assess([], Vitals(blood_glucose=45)).level == "critical")

    pregnancy = Fact(chunk_id=11, kind="diagnosis", tier="clinic", text="Pregnancy, 26 weeks.", recorded_at="2026-06-12")
    pregnant = PatientContext(patient_id="x", display_code="P-X", age=29, sex="F", safety_facts=[pregnancy],
                              conflicts=[], relevant=[])
    a = risk.assess(["headache for four days", "swollen feet"], Vitals(**{**normal, "systolic_bp": 148, "diastolic_bp": 96}),
                    pregnant)
    check("BP 148/96 + headache, pregnancy on record -> possible pre-eclampsia, critical, citing the record",
          a.level == "critical" and any(f.title == "Possible pre-eclampsia" and f.evidence == [11] for f in a.findings))
    check("...the same blood pressure without a pregnancy is not pre-eclampsia",
          not any("pre-eclampsia" in f.title for f in
                  risk.assess(["headache"], Vitals(**{**normal, "systolic_bp": 148, "diastolic_bp": 96})).findings))
    check("cold with normal vitals -> low", risk.assess(["runny nose", "sore throat"], Vitals(**normal)).level == "low")
    check("no vitals at all is flagged as a gap", any("No vital signs" in g for g in risk.assess(["cough"], None).gaps))


def _triage(day: date, first: dict, second: dict):
    """Vital signs at check-in re-order the queue. Runs on reception_desk's test patients, which are deleted
    afterwards (vital signs are append-only, so they must never be written for the demo patients)."""
    print("\nTriage: vital signs at check-in put the sickest patient first")
    c5 = next(p for p in PATIENTS if p["code"] == "P-005")["consult"]
    c6 = next(p for p in PATIENTS if p["code"] == "P-006")["consult"]
    check("before vitals, the queue is in arrival order",
          [r["visit_id"] for r in reception.triage_queue(day)] == [first["id"], second["id"]])
    reception.record_vitals(first["id"], c5["vitals"], ["runny nose", "sore throat"], by="check_scenarios")
    a = reception.record_vitals(second["id"], c6["vitals"], ["fever with chills", "confusion since this morning"],
                                by="check_scenarios")
    check("the desk's vitals and complaint give a critical triage", a.level == "critical",
          "; ".join(f.title for f in a.findings))
    q = reception.triage_queue(day)
    check("the critical patient who arrived second is now first in the queue",
          q[0]["visit_id"] == second["id"] and q[0]["risk_level"] == "critical",
          f"{q[0]['display_code']} {q[0]['risk_level']}: {q[0]['top_finding']}")


if __name__ == "__main__":
    show = set(sys.argv[sys.argv.index("--show") + 1:]) if "--show" in sys.argv else set()
    ids = {p["display_code"]: p["id"] for p in sb.table("patients").select("id, display_code").execute().data}
    allergy_wording()
    risk_rules()
    scenarios(ids, show)
    doctor_tier(ids["P-005"])
    clinic_tier(ids["P-005"])
    receptionist_delete()
    reception_desk()
    print(f"\n{sum(results)}/{len(results)} checks passed")
    sys.exit(0 if all(results) else 1)
