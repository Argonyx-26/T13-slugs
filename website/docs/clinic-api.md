# Clinic tier write API

The dashboard's reception desk and record corrections need these endpoints on the FastAPI orchestrator
(`/api/v1`, same `X-API-Key` and error shape as the existing routes). Each one wraps a function that already
exists in the RAG module on the `sanjana-rag` branch, so the database rules (append-only clinic records,
duplicate check, indexing, triage) stay in one place.

Until they exist, the dashboard works fully in demo mode (`LUMEN_API_URL` unset), which follows the same rules
against a local store (`src/features/patients/server/demo-clinic.ts`, saved to `.data/clinic.json`). With
`LUMEN_API_URL` set, a missing endpoint shows the desk "The clinic server does not support this yet".

Client: `src/features/patients/server/lumen-api.ts` (`registerPatient`, `checkIn`, `addRecord`, `retractRecord`).
Types: `src/features/patients/api/types.ts`.

## POST /patients: register a patient

Wraps `rag.reception.register_patient()`.

```json
{
  "full_name": "Anita Sharma",
  "phone": "9876543210",
  "age": 41,
  "sex": "F",
  "allergies": ["sulfa drugs"],
  "no_known_allergies": false,
  "conditions": ["Type 2 diabetes"],
  "medications": ["Metformin 500 mg twice daily"],
  "check_in": true,
  "allow_duplicate": false
}
```

- `phone` is digits only or `null`. `age` and `sex` (`M` / `F` / `O`) may be `null`.
- `check_in: true` passes today's clinic date as `visit_day`.
- `allergies` together with `no_known_allergies: true` is a 422.

**201**

```json
{ "patient_uuid": "…", "display_code": "P-013", "token": 13 }
```

`token` is `null` when `check_in` was false.

**409**: `PossibleDuplicate`. The desk shows the matches, then re-sends with `allow_duplicate: true` if it is a different person.

```json
{
  "error": {
    "code": "POSSIBLE_DUPLICATE",
    "message": "1 existing patient(s) with the same phone or name",
    "matches": [
      { "patient_uuid": "…", "display_name": "Anita S.", "age": 41, "sex": "F", "reason": "phone" }
    ]
  }
}
```

`reason` is `phone` or `name`, from `find_possible_duplicates()`.

## POST /visits: check a patient in

Wraps `rag.reception.check_in(patient_id, today)`. A patient already waiting today gets the same token back.

Request:

```json
{ "patient_uuid": "…" }
```

**200**:

```json
{ "visit_id": "…", "token": 13 }
```

## POST /visits/{visit_id}/vitals: vital signs and complaint

Wraps `rag.reception.record_vitals()`. It saves the reading, runs `rag.risk.assess_patient(stage="triage")` and
re-orders the queue.

```json
{
  "vitals": {
    "systolic_bp": 96, "diastolic_bp": 60, "heart_rate": 118, "resp_rate": 24,
    "temperature_c": 38.9, "spo2": 93, "on_oxygen": false, "consciousness": "new_confusion",
    "blood_glucose": 240, "weight_kg": null
  },
  "complaint": ["fever", "confusion since morning"]
}
```

- `vitals` may be `null`, in which case triage runs from the complaint and history only.
- Ranges match `backend/sql/06_risk.sql`.

**200**: the `RiskAssessment` (`rag/models.py`), which the dashboard reads as `TriageAssessment`.

## POST /patients/{patient_uuid}/records: add a clinic record

Wraps `rag.store.add_clinic_records()`, which saves and indexes the record. It is append-only.

```json
{ "record_type": "prescription", "content": "Metformin 500 mg twice daily", "recorded_on": "2026-09-26" }
```

- `record_type` is one of `allergy | diagnosis | prescription | lab | visit`.
- For labs, `content` is `"Test: result"`, e.g. `"HbA1c: 7.2 %"`.
- `recorded_on` can't be in the future.

**201**:

```json
{ "record_id": "…" }
```

## POST /records/{record_id}/retract: correct a record

Wraps `rag.store.retract_clinic_record()`. The record leaves the safety facts and the search index, but stays in
`clinic_records` for the audit trail.

```json
{ "reason": "entered_in_error", "note": "Wrong patient" }
```

- `reason` is `entered_in_error`, or `stopped` for prescriptions only (otherwise 422).
- `by` comes from the logged-in user on the server, never from the request.

**200**:

```json
{ "record_id": "…", "reason": "entered_in_error", "retracted_at": "…" }
```

## Change to an existing response

To let the doctor correct a fact from the dashboard, `GET /patients/{id}` must say which record each fact came
from. Add `record_id` (the `clinic_records.id`) to every `Fact` and `LabResult` in `PatientProfile`. It is
`null` for facts that come from doctor notes. Facts without a `record_id` show no correction menu.
