-- Lumen memory layer: corrections, duplicate check, audit trail. Run after 04_reception.sql. Safe to re-run.

-- 1. Exact vector search. Every search is scoped to one patient (by patient_id) or scans the whole clinic, so the
--    clinic-wide HNSW index could only hurt: Postgres would take its ~40 nearest chunks from ALL patients, then
--    filter by patient, silently returning few or none of this patient's records. A clinic's few thousand rows per
--    patient-filtered scan are fast without it.
drop index if exists memory_chunks_embedding_idx;


-- 2. Who did it. Append-only for every API key; rows survive the patient being deleted (no foreign key).
create table if not exists audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor        text not null,                 -- login email, or what the backend reports
  action       text not null,                 -- patient_deleted | record_retracted
  patient_code text,                          -- display code (P-004), kept after the patient is gone
  detail       jsonb
);
alter table audit_log enable row level security;
revoke update, delete, truncate on audit_log from anon, authenticated, service_role;

-- Who approved each AI-drafted note (the doctor's email)
alter table doctor_notes add column if not exists approved_by text;


-- 3. Corrections to the append-only clinic tier. A wrong record is never edited or deleted: a retraction row marks it
--    'entered_in_error' (a typo, the wrong box ticked) or, for a prescription, 'stopped'. Retracted records leave the
--    search index and the safety facts but stay in clinic_records for the audit trail.
create table if not exists clinic_record_retractions (
  record_id    uuid primary key references clinic_records (id) on delete cascade,   -- a record is retracted once
  reason       text not null check (reason in ('entered_in_error', 'stopped')),
  note         text,
  retracted_by text not null,
  retracted_at timestamptz not null default now()
);
alter table clinic_record_retractions enable row level security;
revoke update, delete, truncate on clinic_record_retractions from anon, authenticated, service_role;

create or replace function retract_clinic_record(p_record_id uuid, p_reason text, p_by text, p_note text default null)
returns jsonb
language plpgsql
as $$
declare
  r clinic_records;
  v clinic_record_retractions;
begin
  select * into r from clinic_records where id = p_record_id;
  if not found then
    raise exception 'No clinic record %', p_record_id;
  end if;
  if p_reason = 'stopped' and r.record_type <> 'prescription' then
    raise exception 'Only a prescription can be marked stopped; use entered_in_error';
  end if;
  insert into clinic_record_retractions (record_id, reason, note, retracted_by)
  values (p_record_id, p_reason, p_note, p_by)
  returning * into v;
  delete from memory_chunks where tier = 'clinic' and source_id = p_record_id;   -- same transaction: never half-done
  insert into audit_log (actor, action, patient_code, detail)
  select p_by, 'record_retracted', p.display_code,
         jsonb_build_object('record_id', r.id, 'record_type', r.record_type, 'content', r.content,
                            'reason', p_reason, 'note', p_note)
  from patients p where p.id = r.patient_id;
  return to_jsonb(v);
end;
$$;

-- The clinic records still in force: everything the index and the safety facts are built from.
create or replace function active_clinic_records(p_patient_ids uuid[] default null)
returns setof clinic_records
language sql stable
as $$
  select c.* from clinic_records c
  where (p_patient_ids is null or c.patient_id = any (p_patient_ids))
    and not exists (select 1 from clinic_record_retractions x where x.record_id = c.id);
$$;


-- 4. Existing patients that a new registration may duplicate: the same phone (last 10 digits, so "+91 98…" matches
--    "98…") or the same name. Families share phones, so these are shown to the receptionist, not blocked.
create or replace function find_possible_duplicates(p_full_name text, p_phone text)
returns table (patient_id uuid, display_code text, full_name text, phone text, age int, sex text, reason text)
language sql stable
as $$
  with q as (
    select lower(regexp_replace(trim(p_full_name), '\s+', ' ', 'g')) as name,
           right(nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''), 10) as phone
  )
  select p.id, p.display_code, i.full_name, i.phone, p.age, p.sex,
         case when right(i.phone, 10) = q.phone then 'same phone' else 'same name' end
  from patients p
  join patient_identity i on i.patient_id = p.id
  cross join q
  where right(i.phone, 10) = q.phone
     or lower(regexp_replace(i.full_name, '\s+', ' ', 'g')) = q.name
  order by p.display_code;
$$;


-- 5. Deleting a doctor's note and its search rows in one transaction (two separate calls could leave orphans).
create or replace function delete_doctor_note(p_note_id uuid)
returns boolean
language plpgsql
as $$
begin
  delete from memory_chunks where tier = 'doctor' and source_id = p_note_id;
  delete from doctor_notes where id = p_note_id;
  return found;
end;
$$;


-- Backend-only, like the reception functions
revoke execute on function retract_clinic_record(uuid, text, text, text), active_clinic_records(uuid[]),
                           find_possible_duplicates(text, text), delete_doctor_note(uuid)
  from public, anon, authenticated;
