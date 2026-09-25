-- Lumen memory layer: the reception desk. Run after 02_functions.sql. Safe to re-run.
-- For a clinic with no records system of its own, registration here is where a patient first enters the database:
-- who they are (patient_identity), what they report at the desk (clinic_records), and today's queue (visits).

-- Who the patient is. Kept apart from everything clinical: never embedded, never sent to the LLM.
-- The reception desk finds patients by it; the privacy scrubber can use full_name as a must-redact term.
create table if not exists patient_identity (
  patient_id uuid primary key references patients (id) on delete cascade,
  full_name  text not null check (length(trim(full_name)) > 0),
  phone      text,                               -- digits only
  created_at timestamptz not null default now()
);
create index if not exists patient_identity_phone_idx on patient_identity (phone);

-- The day's queue. The doctor's phone picks the patient from here before recording.
create table if not exists visits (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id) on delete cascade,
  visit_day     date not null,                   -- the clinic's local date, passed in by the backend
  token         int  not null check (token > 0), -- position in that day's queue, 1 = first
  status        text not null default 'waiting' check (status in ('waiting', 'seen')),
  checked_in_at timestamptz not null default now(),
  unique (visit_day, token)
);
create index if not exists visits_patient_idx on visits (patient_id);

alter table patient_identity enable row level security;
alter table visits           enable row level security;


-- 1. Put a patient in a day's queue. Checking in someone already waiting that day returns their existing token.
create or replace function check_in(p_patient_id uuid, p_visit_day date)
returns jsonb
language plpgsql
as $$
declare v visits;
begin
  perform pg_advisory_xact_lock(hashtext('lumen.queue.' || p_visit_day));   -- two desks never share a token
  select * into v from visits
  where patient_id = p_patient_id and visit_day = p_visit_day and status = 'waiting';
  if not found then
    insert into visits (patient_id, visit_day, token)
    values (p_patient_id, p_visit_day,
            (select coalesce(max(token), 0) + 1 from visits where visit_day = p_visit_day))
    returning * into v;
  end if;
  return to_jsonb(v);
end;
$$;


-- 2. A new patient, in one transaction: code, identity, what they reported at the desk, and optionally a check-in.
--    p_intake: [{"record_type": "allergy" | "diagnosis" | "prescription", "content": "..."}]
--    Returns {patient, records, visit}; the backend then indexes `records` for search.
create or replace function register_patient(
  p_full_name text,
  p_phone     text,
  p_age       int,
  p_sex       text,
  p_intake    jsonb default '[]',
  p_visit_day date  default null                 -- null = register without joining the queue
)
returns jsonb
language plpgsql
as $$
declare
  v_patient patients;
  v_records jsonb;
begin
  -- Next free P-number. The lock stops two desks taking the same one.
  perform pg_advisory_xact_lock(hashtext('lumen.patient_code'));
  insert into patients (display_code, age, sex)
  select 'P-' || lpad((coalesce(max(substring(display_code from '^P-(\d+)$')::int), 0) + 1)::text, 3, '0'),
         p_age, p_sex
  from patients
  returning * into v_patient;

  insert into patient_identity (patient_id, full_name, phone)
  values (v_patient.id, trim(p_full_name), nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), ''));

  with added as (
    insert into clinic_records (patient_id, record_type, content, recorded_at)
    select v_patient.id, r ->> 'record_type', r ->> 'content', now()
    from jsonb_array_elements(p_intake) r
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(added)), '[]') into v_records from added;

  return jsonb_build_object(
    'patient', to_jsonb(v_patient),
    'records', v_records,
    'visit',   case when p_visit_day is null then null else check_in(v_patient.id, p_visit_day) end);
end;
$$;


-- 3. The reception search box: a phone number (any 4+ digits of it) or part of a name.
create or replace function search_patients(q text, match_count int default 10)
returns table (patient_id uuid, display_code text, full_name text, phone text, age int, sex text,
               last_visit date)
language sql stable
as $$
  select p.id, p.display_code, i.full_name, i.phone, p.age, p.sex,
         (select max(v.visit_day) from visits v where v.patient_id = p.id)
  from patients p
  join patient_identity i on i.patient_id = p.id
  where (length(regexp_replace(q, '\D', '', 'g')) >= 4
         and i.phone like '%' || regexp_replace(q, '\D', '', 'g') || '%')
     or i.full_name ilike '%' || trim(q) || '%'
     or p.display_code ilike trim(q)
  order by i.full_name
  limit match_count;
$$;


-- 4. One day's queue in token order, with who each patient is.
create or replace function visit_queue(p_visit_day date)
returns table (visit_id uuid, patient_id uuid, display_code text, full_name text, age int, sex text,
               token int, status text, checked_in_at timestamptz)
language sql stable
as $$
  select v.id, p.id, p.display_code, i.full_name, p.age, p.sex, v.token, v.status, v.checked_in_at
  from visits v
  join patients p on p.id = v.patient_id
  left join patient_identity i on i.patient_id = p.id      -- seeded demo patients have no identity row
  where v.visit_day = p_visit_day
  order by v.token;
$$;

-- Names and phone numbers are reachable only through the backend's key, never the app's keys
revoke execute on function check_in(uuid, date), register_patient(text, text, int, text, jsonb, date),
                           search_patients(text, int), visit_queue(date)
  from public, anon, authenticated;
