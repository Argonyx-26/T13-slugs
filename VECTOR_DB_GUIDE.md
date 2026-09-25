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
   - `backend/sql/03_verify.sql`: expect 5 tables with `rls_on=true`, 4 functions, and all four "backend can …" rows `false`.
   - `backend/sql/00_reset.sql` is **only** for wiping an existing project and starting over. It deletes everything.

### 2b. Python
```
cd backend
python -m venv .venv
.venv\Scripts\activate          (Windows)   |   source .venv/bin/activate   (Mac/Linux)
pip install -r requirements.txt
python -m rag.setup_users       # creates doctor@lumen.test and reception@lumen.test with their roles
python -m rag.seed              # 5 demo patients, ~20 records each, indexed (first run downloads the model)
python -m rag.check_scenarios   # should end with "N/N checks passed"
```
Run everything from `backend/` with `python -m rag.<module>`; running the files directly breaks the imports.

---

## 3. Tables

| Table | Tier | What's in it |
|---|---|---|
| `patients` | clinic | `display_code` (e.g. P-004), age, sex. No names anywhere |
| `clinic_records` | clinic | `record_type` (visit / lab / prescription / allergy / diagnosis), text, date |
| `doctor_notes` | doctor | The Brain's JSON note, `status` draft or approved |
| `doctor_hidden_patients` | doctor | The doctor's "delete" = hide from their list |
| `memory_chunks` | both | The search index: one row per record or note section, with its embedding (384 numbers) and keyword index |

**Who can delete what**

| Action | Allowed? |
|---|---|
| Backend key updates or deletes clinic records / patients | **No**: `permission denied` from the database |
| Doctor "deletes" a patient | Only hides them (`hide_patient`), with Undo |
| Doctor wipes their own notes for a patient | Yes: `clear_doctor_memory` (clinic records stay) |
| Delete a patient from the clinic | Only via `receptionist_delete_patient`, with a **receptionist's** login token. A doctor's token is refused |

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
store.approve_note(note["id"])                         # when the doctor clicks Approve
```

`ctx` is a Pydantic model (`rag/models.py`) that FastAPI can return directly:
- `safety_facts`: always present, each tagged `clinic` or `doctor`.
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
| `POST /notes/{id}/approve` | `store.approve_note()` |
| `DELETE /notes/{id}` | `store.delete_doctor_note()` |
| `POST /patients/{id}/clear-memory` | `store.clear_doctor_memory()` |
| `POST /patients/{id}/hide`, `/unhide` | `store.hide_patient()`, `store.unhide_patient()` |
| `DELETE /clinic/patients/{id}` | `store.receptionist_delete_patient(token, id)`, receptionist screen only |
| `GET /search/similar?q=...` | `store.find_similar_patients()` |
| `POST /admin/sync` | `sync.reindex()`, the "nightly sync" button |

Showing the right buttons for each role is only for convenience. The real protection is in the database.

**What the Brain needs to agree to**
- **Pass 1 outputs English** `symptoms`, `medications` and a `clinical` rewording. The embedding model is English-only, and the clinical rewording is what makes retrieval reliable (see the research doc).
- **Pass 2's note JSON** uses exactly the keys in `rag/chunks.py → NOTE_SECTIONS`, and cites evidence as `H<id>`.

---

## 5. Files

| File | What it does |
|---|---|
| `sql/01_schema.sql`, `02_functions.sql`, `03_verify.sql`, `00_reset.sql` | Database setup, checks and reset |
| `rag/db.py` | Supabase clients (backend key; acting as a logged-in user) |
| `rag/embedder.py` | Local embedding model (`EMBED_MODEL`, default MedEmbed-small) |
| `rag/chunks.py` | Records and notes → search-index rows |
| `rag/store.py` | Reads and writes for both tiers, search, logins |
| `rag/context.py` | `get_context()`, conflict check, `format_for_llm()` |
| `rag/drugs.py`, `rag/data/*.json` | Brand → generic → class lookup, interaction rules, `safety_hits()`. Demo coverage, **not a clinical reference** |
| `rag/sync.py` | Rebuilds the search index |
| `rag/setup_users.py` | Creates the demo logins with roles |
| `rag/demo_data.py`, `rag/seed.py` | The 5 demo patients and the loader |
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
