# Lumen Memory Layer: Build & Run Guide

The patient "long-term memory" behind the Central Brain, built on **Supabase + pgvector**, with the embedding model running **locally** inside FastAPI. The two-tier idea comes from `RAG_Database_Architecture.md`; the experiments behind the design choices are in `sanjana research/RAG_Dual_Engine_Research.md`.

---

## 1. What it is, in simple terms

**Two tiers of data**
- **Clinic tier:** the clinic's own records (visits, labs, prescriptions, allergies, diagnoses). The backend may **add** to it but can never change or delete it; the database itself refuses.
- **Doctor tier:** the doctor's own notes. AI-written notes arrive as **drafts** and only become memory when the doctor approves them.

**Two engines**
- **Safety facts:** allergies, diagnoses and prescriptions from both tiers are **always** handed to the AI. They are never ranked, so they can't be "searched away".
- **Hybrid search:** finds past records related to today's consult by **meaning** (embeddings: "thirsty" ≈ "blood sugar") and by **keywords** (exact names like "warfarin" or "HbA1c").

```
Flutter ─► FastAPI ─► WhisperX ─► Presidio ─► Brain pass 1: English symptoms, medicines, clinical rewording
                                                      │
                                                      ▼
                              get_context()  ─ safety facts (always) + hybrid search + conflict check
                              safety_hits()  ─ fixed drug rules (allergy classes, interactions)
                                                      │
                                                      ▼
                              Brain pass 2: transcript + memory block ─► JSON note ─► Presidio
                                                      │
                                                      ▼
                              save_draft_note() ─► doctor reviews ─► approve_note() ─► indexed as memory
```

**Golden rules**
1. Only **scrubbed** text (after Presidio) is stored or indexed.
2. **Fake patients only**, never real patient data.
3. The **secret key stays in FastAPI**. The Flutter app never talks to Supabase directly.

---

## 2. Setup

### 2a. Supabase
1. Create a project at supabase.com (any region close to you).
2. **Project Settings → API keys:** copy the project URL, the publishable key and the secret key into `backend/.env`:
   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_...
   SUPABASE_SERVICE_KEY=sb_secret_...
   DEMO_USER_PASSWORD=<pick one for the two demo logins>
   ```
   `.env` is git-ignored. Never commit it.
3. **SQL Editor:** paste and run each file in order, pasting **only** the file's SQL:
   - `backend/sql/01_schema.sql`: tables, indexes, permissions.
   - `backend/sql/02_functions.sql`: search and permission functions.
   - `backend/sql/04_reception.sql`: the reception desk (patient identity, the day's queue).
   - `backend/sql/05_safety_fixes.sql`: corrections, duplicate check, audit log, exact vector search.
   - `backend/sql/06_risk.sql`: vital signs, risk assessments and the risk-ordered queue (see `RISK_DETECTION.md`).
     **Already set up?** Re-run `02_functions.sql`, then run `05_safety_fixes.sql` and `06_risk.sql`.
   - `backend/sql/03_verify.sql`: expect 11 tables with `rls_on=true`, 13 functions, no "ann index" row, and all twelve "backend can …" rows `false`.
   - `backend/sql/00_reset.sql` is **only** for wiping an existing project and starting over. It deletes everything.

### 2b. Python
```
cd backend
python -m venv .venv
.venv\Scripts\activate          (Windows)   |   source .venv/bin/activate   (Mac/Linux)
pip install -r requirements.txt
python -m rag.setup_users       # creates doctor@lumen.test and reception@lumen.test with their roles
python -m rag.seed              # 6 demo patients, ~20 records each, indexed (first run downloads the model)
python -m rag.check_scenarios   # should end with "N/N checks passed"
```
Run everything from `backend/` with `python -m rag.<module>`; running the files directly breaks the imports.

---

## 2c. Clinics with no records system

Most small clinics keep a paper register, not a database. For them, **the reception desk is where a patient enters
the database**; there is nothing to import. The receptionist:

1. **Searches** by phone number or name. Found: check them in (`reception.check_in`). Not found:
2. **Registers** them (`reception.register_patient`): name, phone, age, sex, plus what the patient reports:
   allergies (or the **No known allergies** box), long-term conditions and current medicines. They get the next
   P-number and a token in today's queue.

**Search first, always.** `register_patient` refuses (`reception.PossibleDuplicate`, with `.matches`) when a patient
with the same phone or name exists. A second P-number would split the history, and an allergy on the first would be
invisible on the second. The desk checks the match in instead, or, for a genuinely different person (families share
phones), calls again with `allow_duplicate=True`.

The reported items become clinic records ("… reported by patient at registration"), so allergy and interaction checks
work from the first consult. **Blank allergies are saved as nothing**, and the LLM is told the allergy status was
never recorded; they never read as "no allergies". From then on, every approved consult note adds to the patient's
memory, so the history builds up visit by visit.

`visit_day` is the clinic's local date, passed in by FastAPI (the database runs on UTC).

### Fixing a wrong clinic record

Clinic records are never edited. A wrong one is **retracted**:
`store.retract_clinic_record(record_id, reason, by=user["email"], note=...)`

- `entered_in_error`: a typo, or the wrong box ticked (for example "No known allergies" by mistake).
- `stopped`: a prescription the patient no longer takes. Only prescriptions can be stopped.

The record leaves the search index and the safety facts in the same transaction. It stays in `clinic_records`, and
the retraction goes into `audit_log`. There is no un-retract: add a new record instead.

### Where the database runs

For the demo it runs on hosted Supabase. For a real clinic, run **self-hosted Supabase** (Docker) on a small machine in
the clinic, and give each clinic its own. The code doesn't change: only `SUPABASE_URL` and the keys in `.env` do.
- **Patient data stays in the clinic**, including names and phone numbers (`patient_identity`), not only the scrubbed text.
- **The clinic keeps working when the internet is down.** Reception and the doctor's phone reach it over the clinic's Wi-Fi.
- **One clinic per database.** The tables have no `clinic_id`, and `find_similar_patients` searches every patient in
  the database, so two clinics must never share one.
- **Backups:** a nightly encrypted `pg_dump` to a drive the clinic owns.

---

## 3. Tables

| Table | Tier | What's in it |
|---|---|---|
| `patients` | clinic | `display_code` (e.g. P-004), age, sex. No names anywhere |
| `clinic_records` | clinic | `record_type` (visit / lab / prescription / allergy / diagnosis), text, date |
| `doctor_notes` | doctor | The Brain's JSON note, `status` draft or approved |
| `doctor_hidden_patients` | doctor | The doctor's "delete" = hide from their list |
| `memory_chunks` | both | The search index: one row per record or note section, with its embedding (384 numbers) and keyword index |
| `patient_identity` | desk | Name and phone, for the reception search. Never embedded, never sent to the LLM |
| `visits` | desk | The day's queue: token, `waiting` / `seen` |
| `clinic_record_retractions` | clinic | Clinic records marked `entered_in_error` or `stopped` |
| `audit_log` | — | Who deleted a patient or retracted a record. Append-only, kept after the patient is deleted |

**Who can delete what**

| Action | Allowed? |
|---|---|
| Backend key updates or deletes clinic records / patients | **No**: `permission denied` from the database |
| Doctor "deletes" a patient | Only hides them (`hide_patient`), with Undo |
| Doctor wipes their own notes for a patient | Yes: `clear_doctor_memory` (clinic records stay) |
| Delete a patient from the clinic | Only via `receptionist_delete_patient`, with a **receptionist's** login token. A doctor's token is refused. The deletion is written to `audit_log` with the receptionist's email |
| Correct a clinic record | Only by retracting it (`retract_clinic_record`); the original stays |
| Edit or delete `audit_log` / retractions | **No**: `permission denied` from the database |

---

## 4. Using it from FastAPI

```python
from rag.context import get_context, format_for_llm
from rag.drugs import safety_hits
from rag import store

# After Brain pass 1 (English, even if the consult was Kannada-English)
ctx = get_context(patient_id,
                  symptoms=["excessive thirst", "frequent urination at night"],
                  medications=["Augmentin 625"],
                  extra_queries=["polydipsia and polyuria, possible hyperglycaemia"])  # the clinical rewording
memory_block = format_for_llm(ctx)             # goes into Brain pass 2; evidence ids look like [H123]
rule_findings = safety_hits(["Augmentin 625"], ctx)

# After Brain pass 2 + Presidio
note = store.save_draft_note(patient_id, note_json)   # keys: symptoms, history, prescriptions, allergies, action_items
user = store.require_role(token, "doctor")             # FastAPI checks the role for everything but deleting a patient
store.approve_note(note["id"], approved_by=user["email"])   # when the doctor clicks Approve
```

`ctx` is a Pydantic model (`rag/models.py`) that FastAPI can return directly:
- `safety_facts`: always present, each tagged `clinic` or `doctor`. Not capped: every allergy, diagnosis and prescription
  still in force. `get_context` first indexes anything the search index is missing (`store.ensure_indexed`), so a
  record saved while the embedder was down still counts. If the embedder is still down, the consult fails with an error
  rather than going ahead without it.
- `conflicts`: for example, the clinic says "no known allergies" but the doctor's note records one. **Never auto-resolved.**
- `relevant`: past records, each with `matched_query` (what in today's consult pulled it in) and `days_ago`.

**Suggested endpoints**

| Endpoint | Calls |
|---|---|
| `POST /auth/login` | `store.login()`, returns token + role |
| `GET /patients` | `store.list_patients()` |
| `POST /patients/{id}/context` | `get_context()` + `format_for_llm()` + `safety_hits()` |
| `POST /patients/{id}/notes` | `store.save_draft_note()` |
| `PATCH /notes/{id}` | `store.update_draft_note()` |
| `POST /notes/{id}/approve` | `store.require_role(token, "doctor")`, then `store.approve_note(id, approved_by=email)` |
| `POST /clinic/records/{id}/retract` | `store.retract_clinic_record(id, reason, by=email)` |
| `DELETE /notes/{id}` | `store.delete_doctor_note()` |
| `POST /patients/{id}/clear-memory` | `store.clear_doctor_memory()` |
| `POST /patients/{id}/hide`, `/unhide` | `store.hide_patient()`, `store.unhide_patient()` |
| `DELETE /clinic/patients/{id}` | `store.receptionist_delete_patient(token, id)`, receptionist screen only |
| `POST /clinic/patients` | `reception.register_patient(...)`, reception screen: new patient + check-in. `PossibleDuplicate` → 409 with the matches |
| `GET /clinic/patients/search?q=...` | `reception.search_patients()`: phone digits, part of a name, or a P-number |
| `POST /clinic/patients/{id}/check-in` | `reception.check_in(id, clinic_today)` |
| `POST /visits/{id}/vitals` | `reception.record_vitals(visit_id, vitals, complaint, by=email)`: saves, triages, returns the `RiskAssessment` |
| `GET /visits/today` | `reception.triage_queue(clinic_today)`: riskiest first, with `risk_level`, `top_finding`, `urgency`. The doctor's phone picks the patient here |
| `POST /patients/{id}/risk` | `risk.assess_patient(id, symptoms, stage="consult", ctx=ctx)` after Brain pass 1; `risk.format_for_llm()` goes into Brain pass 2 |
| `GET /search/similar?q=...` | `store.find_similar_patients()` |
| `POST /admin/sync` | `sync.reindex()`, the "nightly sync" button |

Showing the right buttons for each role is only for convenience. The database itself enforces the append-only clinic
tier, the audit log and who may delete a patient. **Everything else runs on the backend key**, so each FastAPI route
must call `store.require_role(token, ...)` first: a receptionist must not be able to read or approve clinical notes.

**What the Brain needs to agree to**
- **Pass 1 outputs English** `symptoms`, `medications` and a `clinical` rewording. The embedding model is English-only, and the clinical rewording is what makes retrieval reliable (see the research doc).
- **Pass 2's note JSON** uses exactly the keys in `rag/chunks.py → NOTE_SECTIONS`, and cites evidence as `H<id>`.

---

## 5. Files

| File | What it does |
|---|---|
| `sql/01_schema.sql`, `02_functions.sql`, `04_reception.sql`, `05_safety_fixes.sql`, `03_verify.sql`, `00_reset.sql` | Database setup, checks and reset |
| `rag/db.py` | Supabase clients (backend key; acting as a logged-in user) |
| `rag/embedder.py` | Local embedding model (`EMBED_MODEL`, default MedEmbed-small) |
| `rag/chunks.py` | Records and notes → search-index rows |
| `rag/store.py` | Reads and writes for both tiers, search, logins |
| `rag/context.py` | `get_context()`, conflict check, `format_for_llm()` |
| `rag/drugs.py`, `rag/data/*.json` | Brand → generic → class lookup, interaction rules, `safety_hits()`. Demo coverage, **not a clinical reference** |
| `rag/sync.py` | Rebuilds the search index |
| `rag/risk.py`, `rag/data/red_flags.json` | Early health-risk detection: NEWS2, vital thresholds, red flags, sepsis, trends (`RISK_DETECTION.md`) |
| `rag/reception.py` | Registration (with the duplicate check), patient search, check-in and the day's queue |
| `rag/setup_users.py` | Creates the demo logins with roles |
| `rag/demo_data.py`, `rag/seed.py` | The 6 demo patients (with vital signs) and the loader |
| `rag/check_scenarios.py` | End-to-end checks |

## 6. Settings you might tune

| Setting | Where | What it does |
|---|---|---|
| `EMBED_MODEL` | `.env` / `embedder.py` | Embedding model; must produce 384 numbers. Re-run `python -m rag.sync` after changing it |
| `MIN_RELATIVE_SCORE` | `context.py` | How strict the "relevant records" list is (0.25; higher = shorter lists, but risks dropping real matches) |
| `KEYWORD_BONUS` | `context.py` | Extra weight for an exact keyword hit |
| `GENERIC_WORDS` | `store.py` | Words left out of keyword search ("mild", "night"…) |
| `recent_days`, `recent_bonus` | `02_functions.sql` | Small ranking bonus for recent doctor notes (ranking only, never overrides a safety fact) |

## 7. Common mistakes

| Mistake | Symptom |
|---|---|
| Pasted instructions into the SQL Editor along with the SQL | `syntax error at or near ...` |
| Ran a file directly (`python rag/seed.py`) | `ImportError: attempted relative import` |
| Embedding model with a different vector size | `expected 384 dimensions` on insert |
| Brain's note JSON uses other section names | Approved notes save but produce no search rows |
| Searching with raw Kannada-English text | Poor retrieval; send Brain pass 1's English output |
| Role put in `user_metadata` instead of `app_metadata` | Receptionist delete always refused, and users could edit their own role |
| Role changed but the person didn't log in again | Their old token has no role, so delete is refused |
| Secret key in the Flutter app or a commit | Anyone can read the whole database: rotate the key immediately |
