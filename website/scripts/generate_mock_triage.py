"""Generates src/constants/mock-triage.ts: the demo patients' triage, computed by the real risk engine.

The dashboard's demo mode can't run Python, so instead of hand-writing risk levels (which would drift from the
backend), this runs backend/rag/risk.py on each demo patient's desk vitals, complaint and record, and writes the
result as TypeScript. Re-run it whenever the rules or these inputs change:

    # backend/ from the sanjana-rag branch, run with the backend's Python environment
    python website/scripts/generate_mock_triage.py --backend backend --out website/src/constants/mock-triage.ts
    cd website && npx oxfmt --write src/constants/mock-triage.ts    # the project's quote style

The inputs below mirror src/constants/mock-api-patients.ts: same ids, complaints, and records.
"""
import argparse
import json
import sys
from pathlib import Path

# Each patient: today's complaint as the desk records it (English), vital signs taken at check-in, the record items
# the rules may use as (date, kind, text), and earlier readings for trends. Times: the order they checked in.
PATIENTS = [
    {"id": "5f8b2a3c-9e1d-4c67-b4a2-0d7e6f3c9b81", "name": "Deepak V.", "checked_in": "08:55",
     "complaint": ["repeat prescription"],
     "vitals": {"resp_rate": 14, "spo2": 99, "systolic_bp": 122, "diastolic_bp": 78, "heart_rate": 70,
                "temperature_c": 36.7, "consciousness": "alert"},
     "record": [("2022-03-08", "diagnosis", "Hypothyroidism."), ("2024-07-15", "prescription", "Levothyroxine 50 mcg once daily.")]},
    {"id": "a4c7e2f9-3b6d-4e18-8f5a-2b9c0d1e7a52", "name": "Fatima Z.", "checked_in": "09:05",
     "complaint": ["fever", "left ear pain since yesterday"],
     "vitals": {"resp_rate": 18, "spo2": 98, "systolic_bp": 116, "diastolic_bp": 74, "heart_rate": 96,
                "temperature_c": 38.3, "consciousness": "alert"},
     "record": []},
    {"id": "cb2759d8-3d91-4a4d-8bd2-026f68f76426", "name": "Ravi K.", "checked_in": "09:20",
     "complaint": ["sore throat", "fever for three days"],
     "vitals": {"resp_rate": 18, "spo2": 97, "systolic_bp": 138, "diastolic_bp": 86, "heart_rate": 94,
                "temperature_c": 38.4, "consciousness": "alert"},
     "record": [("2023-11-10", "diagnosis", "Hypertension."), ("2023-11-10", "prescription", "Amlodipine 5 mg once daily."),
                ("2024-03-02", "allergy", "Allergy to penicillin.")]},
    {"id": "91786a1e-1ee8-4f60-8191-8a74c0e3edd1", "name": "Lakshmi S.", "checked_in": "09:30",
     "complaint": ["right knee pain, worse on stairs"],
     "vitals": {"resp_rate": 16, "spo2": 97, "systolic_bp": 142, "diastolic_bp": 84, "heart_rate": 92,
                "temperature_c": 36.6, "consciousness": "alert"},
     "record": [("2026-06-02", "diagnosis", "Atrial fibrillation."), ("2022-08-15", "diagnosis", "Hypertension."),
                ("2026-06-02", "prescription", "Warfarin 5 mg once daily."), ("2022-08-15", "prescription", "Telmisartan 40 mg once daily.")]},
    {"id": "9c7aa0d7-24a7-4a0d-93f0-3695c5d4df45", "name": "Arjun M.", "checked_in": "09:40",
     "complaint": ["diabetes review", "more tired than usual"],
     "vitals": {"resp_rate": 16, "spo2": 98, "systolic_bp": 136, "diastolic_bp": 84, "heart_rate": 82,
                "temperature_c": 36.8, "consciousness": "alert", "blood_glucose": 268},
     "record": [("2023-05-18", "diagnosis", "Type 2 diabetes."), ("2023-05-18", "prescription", "Metformin 500 mg twice daily."),
                ("2026-01-15", "lab", "HbA1c 8.1 %.")]},
    {"id": "b6f1c0e2-4d3a-4f7e-9a51-2c8d7e3f9a14", "name": "Priya N.", "checked_in": "09:50",
     "complaint": ["recurring one-sided headaches", "nausea with headaches"],
     "vitals": {"resp_rate": 16, "spo2": 98, "systolic_bp": 118, "diastolic_bp": 76, "heart_rate": 78,
                "temperature_c": 36.8, "consciousness": "alert"},
     "record": [("2021-04-12", "diagnosis", "Bronchial asthma."), ("2021-04-12", "prescription", "Budesonide 200 mcg inhaler twice daily.")]},
    {"id": "4a2e9d71-8c5b-4e03-b7f6-91d2a3c4e5f8", "name": "Meena R.", "checked_in": "10:05",
     "complaint": ["always thirsty", "passing urine often at night"],
     "vitals": {"resp_rate": 16, "spo2": 98, "systolic_bp": 134, "diastolic_bp": 84, "heart_rate": 84,
                "temperature_c": 36.8, "consciousness": "alert", "blood_glucose": 231},
     "record": [("2024-10-02", "diagnosis", "Raised cholesterol."), ("2024-10-02", "prescription", "Atorvastatin 10 mg once daily."),
                ("2026-03-24", "lab", "Fasting glucose 108 mg/dL."), ("2026-03-24", "lab", "HbA1c 6.2 %.")]},
    {"id": "d81f3b6a-2e7c-4a95-8c14-6b0e9f2d7a33", "name": "Farhan A.", "checked_in": "10:15",
     "complaint": ["lower back pain after lifting"],
     "vitals": {"resp_rate": 16, "spo2": 97, "systolic_bp": 146, "diastolic_bp": 88, "heart_rate": 84,
                "temperature_c": 36.7, "consciousness": "alert", "blood_glucose": 176},
     "record": [("2021-02-10", "diagnosis", "Type 2 diabetes."), ("2022-05-06", "diagnosis", "Hypertension."),
                ("2026-06-18", "diagnosis", "Chronic kidney disease, stage 3b."), ("2021-02-10", "prescription", "Metformin 1 g twice daily."),
                ("2022-05-06", "prescription", "Amlodipine 10 mg once daily.")]},
    {"id": "7c3a5e19-b2d4-4f86-a0e1-3f9b8c6d2e47", "name": "Kavya D.", "checked_in": "10:25",
     "complaint": ["headache for four days", "swollen feet"],
     "vitals": {"resp_rate": 18, "spo2": 98, "systolic_bp": 148, "diastolic_bp": 96, "heart_rate": 90,
                "temperature_c": 36.9, "consciousness": "alert"},
     "record": [("2026-06-12", "diagnosis", "Pregnancy, 26 weeks (first pregnancy; due 1 Jan 2027).")],
     "readings": [("2026-06-12", {"systolic_bp": 112, "diastolic_bp": 70}),
                  ("2026-08-07", {"systolic_bp": 118, "diastolic_bp": 76}),
                  ("2026-09-11", {"systolic_bp": 138, "diastolic_bp": 88})]},
    {"id": "1e9d4c7b-6a3f-4b28-9d05-8e2c1b7a4f66", "name": "Arun P.", "checked_in": "10:40",
     "complaint": ["runny nose", "sore throat for two days"],
     "vitals": {"resp_rate": 16, "spo2": 99, "systolic_bp": 120, "diastolic_bp": 76, "heart_rate": 80,
                "temperature_c": 37.4, "consciousness": "alert"},
     "record": []},
    {"id": "2d6f9a1c-7e4b-4a3d-95c8-6f1e0b2a8d19", "name": "Sunita B.", "checked_in": "10:50",
     "complaint": ["cough for two weeks"],
     "vitals": {"resp_rate": 18, "spo2": 97, "systolic_bp": 124, "diastolic_bp": 80, "heart_rate": 88,
                "temperature_c": 37.6, "consciousness": "alert", "weight_kg": 52},
     "record": []},
    {"id": "e5b8c2d1-6f4a-4b97-8e3c-0a1d2f7b9c64", "name": "Gopal R.", "checked_in": "11:05",
     "complaint": ["fever with chills since yesterday", "confusion since this morning",
                   "redness and pus from the heel wound"],
     "vitals": {"resp_rate": 24, "spo2": 94, "systolic_bp": 94, "diastolic_bp": 58, "heart_rate": 118,
                "temperature_c": 38.9, "consciousness": "new_confusion", "blood_glucose": 240},
     "record": [("2018-04-20", "diagnosis", "Type 2 diabetes."), ("2018-04-20", "prescription", "Metformin 500 mg twice daily."),
                ("2026-09-15", "visit", "Diabetic foot check: small ulcer on the left heel, cleaned and dressed.")]},
]
DAY = "2026-09-25"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="backend", help="folder containing the rag package")
    ap.add_argument("--out", default="website/src/constants/mock-triage.ts")
    args = ap.parse_args()
    sys.path.insert(0, str(Path(args.backend).resolve()))
    from rag import risk                                       # noqa: E402  (after sys.path)
    from rag.models import Fact, Match, PatientContext, Vitals  # noqa: E402

    out = {}
    for p in PATIENTS:
        facts, relevant = [], []
        for i, (day, kind, text) in enumerate(p["record"], start=1):
            if kind in ("allergy", "diagnosis", "prescription"):      # safety facts: always given to the rules
                facts.append(Fact(chunk_id=i, kind=kind, tier="clinic", text=text, recorded_at=day))
            else:                                                     # labs and visits: as if found by search
                relevant.append(Match(chunk_id=i, tier="clinic", section=kind, text=text, recorded_at=day,
                                      days_ago=0, matched_query="", similarity=0.0, score=0.0))
        ctx = PatientContext(patient_id=p["id"], display_code=p["name"], age=None, sex=None,
                             safety_facts=facts, conflicts=[], relevant=relevant)
        readings = [(f"{d}T09:00:00+05:30", Vitals(**v)) for d, v in p.get("readings", [])]
        a = risk.assess(p["complaint"], Vitals(**p["vitals"]), ctx, readings)
        a.patient_id, a.stage, a.assessed_at = p["id"], "triage", f"{DAY}T{p['checked_in']}:00+05:30"
        out[p["id"]] = a.model_dump(mode="json")
        print(f"{p['name']:<11} {a.level:<8} " + "; ".join(f.title for f in a.findings), file=sys.stderr)

    body = json.dumps(out, indent=2, ensure_ascii=False)
    Path(args.out).write_text(
        "// ============================================================\n"
        "// GENERATED by website/scripts/generate_mock_triage.py. Do not edit by hand.\n"
        "// ============================================================\n"
        "// The demo patients' triage at check-in, computed by the backend's risk engine\n"
        "// (backend/rag/risk.py) from their desk vitals, complaint and record, so the demo\n"
        "// shows exactly what the real rules decide.\n"
        "// ============================================================\n\n"
        "import type { TriageAssessment } from '@/features/patients/api/types';\n\n"
        f"export const MOCK_TRIAGE: Record<string, TriageAssessment> = {body};\n",
        encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
