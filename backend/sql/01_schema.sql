-- Lumen memory layer: tables, indexes and permissions.
-- Tier 1 = the clinic's records (the backend may add, never change or delete).
-- Tier 2 = the doctor's own notes (AI drafts become memory only after approval).
-- memory_chunks = one search index over both tiers (meaning + keywords).
-- Run in the Supabase SQL Editor. Safe to re-run.

create extension if not exists vector;

-- ---------- Tier 1: clinic ----------
create table if not exists patients (
  id           uuid primary key default gen_random_uuid(),
  display_code text not null unique,          -- e.g. P-004; no names are stored anywhere
  age          int check (age between 0 and 130),
  sex          text,
  created_at   timestamptz not null default now()
);

create table if not exists clinic_records (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients (id) on delete cascade,
  record_type text not null check (record_type in ('visit', 'lab', 'prescription', 'allergy', 'diagnosis')),
  content     text not null,
  recorded_at timestamptz not null
);
create index if not exists clinic_records_patient_idx on clinic_records (patient_id);

-- ---------- Tier 2: doctor ----------
create table if not exists doctor_notes (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients (id) on delete cascade,
  note_json   jsonb not null,                 -- scrubbed LLM output, keys = chunks.NOTE_SECTIONS
  status      text not null default 'draft' check (status in ('draft', 'approved')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists doctor_notes_patient_idx on doctor_notes (patient_id);

-- The doctor's "delete" only hides a patient from their list; clinic data is untouched
create table if not exists doctor_hidden_patients (
  patient_id uuid primary key references patients (id) on delete cascade,
  hidden_at  timestamptz not null default now()
);

-- ---------- Search index over both tiers ----------
create table if not exists memory_chunks (
  id          bigint generated always as identity primary key,
  patient_id  uuid not null references patients (id) on delete cascade,
  tier        text not null check (tier in ('clinic', 'doctor')),
  source_id   uuid not null,                  -- clinic_records.id or doctor_notes.id
  section     text not null,                  -- record_type for clinic, note section for doctor
  content     text not null,                  -- 'YYYY-MM-DD | section | text'
  embedding   vector(384) not null,           -- MedEmbed-small / bge-small size
  fts         tsvector generated always as (to_tsvector('english', content)) stored,
  recorded_at timestamptz not null,
  unique (tier, source_id, section)           -- re-indexing never creates duplicates
);
create index if not exists memory_chunks_patient_idx on memory_chunks (patient_id);
create index if not exists memory_chunks_embedding_idx on memory_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists memory_chunks_fts_idx on memory_chunks using gin (fts);

-- ---------- Permissions ----------
-- RLS on with no policies: the Flutter app's anon/user keys can read nothing directly; everything goes via FastAPI.
alter table patients               enable row level security;
alter table clinic_records         enable row level security;
alter table doctor_notes           enable row level security;
alter table doctor_hidden_patients enable row level security;
alter table memory_chunks          enable row level security;

-- Tier 1 is append-only for every API key, including the backend's secret key.
-- The only way to remove a patient is receptionist_delete_patient() in 02_functions.sql.
revoke update, delete, truncate on patients, clinic_records from anon, authenticated, service_role;
