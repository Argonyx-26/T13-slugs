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

from . import reception, store
from .context import format_for_llm, get_context
from .db import service as sb
from .demo_data import PATIENTS
from .drugs import safety_hits
from .setup_users import USERS

EXPECT = {
    "P-001": {"fact": "asthma", "relevant": "beta-blockers", "hit": "drug_interaction"},
    "P-002": {"conflict": True, "hit": "allergy_conflict"},
    "P-003": {"fact": "warfarin", "relevant": "nsaids", "hit": "drug_interaction"},
    "P-004": {"relevant": "hba1c"},
    "P-005": {"conflict": False, "no_hits": True},
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
        if code in show:
            print("\n" + format_for_llm(ctx) + "\n")


def doctor_tier(pid: str):
    print("\nDoctor notes: draft -> approve -> clear (P-005)")
    marker = "zebra-stripe rash on left forearm"          # a phrase no seeded record contains
    found = lambda: any(marker in r["content"] for r in store.search(pid, marker, k=3))
    note = store.save_draft_note(pid, {"symptoms": [marker]})
    try:
        check("draft note is NOT searchable", not found())
        store.approve_note(note["id"])
        check("approved note IS searchable", found())
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
        check("marking seen", reception.mark_visit_seen(second["visit"]["id"])
              and [v["status"] for v in reception.visit_queue(day) if v["patient_id"] == pid2] == ["seen"])
    finally:
        token = store.login(next(e for e, r in USERS.items() if r == "receptionist"), password)["token"]
        for p in (pid, pid2):
            store.receptionist_delete_patient(token, p)


if __name__ == "__main__":
    show = set(sys.argv[sys.argv.index("--show") + 1:]) if "--show" in sys.argv else set()
    ids = {p["display_code"]: p["id"] for p in sb.table("patients").select("id, display_code").execute().data}
    scenarios(ids, show)
    doctor_tier(ids["P-005"])
    clinic_tier(ids["P-005"])
    receptionist_delete()
    reception_desk()
    print(f"\n{sum(results)}/{len(results)} checks passed")
    sys.exit(0 if all(results) else 1)
