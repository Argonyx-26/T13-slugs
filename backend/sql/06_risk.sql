-- Lumen: early health-risk detection. Vital signs taken at check-in, the risk assessments made from them
-- (rag/risk.py), and a queue ordered by risk. Run after 05_safety_fixes.sql. Safe to re-run.

-- Vital signs, one row per measurement. Append-only like the clinic tier: a wrong reading is re-measured,
-- and the newest reading is the one used.
create table if not exists vital_signs (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references patients (id) on delete cascade,
  visit_id      uuid references visits (id) on delete cascade,
  systolic_bp   int  check (systolic_bp between 40 and 300),          -- mmHg
  diastolic_bp  int  check (diastolic_bp between 20 and 200),
  heart_rate    int  check (heart_rate between 20 and 250),           -- beats/min
  resp_rate     int  check (resp_rate between 4 and 70),              -- breaths/min
  temperature_c numeric(4, 1) check (temperature_c between 30 and 45),
  spo2          int  check (spo2 between 50 and 100),                 -- %
  on_oxygen     boolean not null default false,
  consciousness text check (consciousness in ('alert', 'new_confusion', 'voice', 'pain', 'unresponsive')),
  blood_glucose int  check (blood_glucose between 10 and 1000),       -- mg/dL, random
  weight_kg     numeric(5, 1) check (weight_kg between 1 and 400),
  recorded_by   text not null,
  recorded_at   timestamptz not null default now()
);
create index if not exists vital_signs_patient_idx on vital_signs (patient_id, recorded_at);

-- Every risk assessment made (triage at check-in, then again at the consult). The latest one per visit is shown.
create table if not exists risk_assessments (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patients (id) on delete cascade,
  visit_id       uuid references visits (id) on delete cascade,
  stage          text not null check (stage in ('triage', 'consult')),
  level          text not null check (level in ('low', 'medium', 'high', 'critical')),
  news2          int  check (news2 between 0 and 20),
  vital_signs_id uuid references vital_signs (id) on delete cascade,
  findings       jsonb not null default '[]',        -- RiskFinding list, highest level first
  assessment     jsonb not null,                     -- the full RiskAssessment, as the doctor saw it
  assessed_at    timestamptz not null default now()
);
create index if not exists risk_assessments_visit_idx on risk_assessments (visit_id, assessed_at desc);
create index if not exists risk_assessments_patient_idx on risk_assessments (patient_id, assessed_at desc);

alter table vital_signs      enable row level security;
alter table risk_assessments enable row level security;
revoke update, delete, truncate on vital_signs, risk_assessments from anon, authenticated, service_role;


-- The day's queue, riskiest first: critical, high, medium, then everyone else in token order.
-- Patients not yet assessed keep their token order (unknown is never ranked below low). Seen patients go last.
create or replace function triage_queue(p_visit_day date)
returns table (visit_id uuid, patient_id uuid, display_code text, full_name text, age int, sex text,
               token int, status text, checked_in_at timestamptz,
               risk_level text, news2 int, top_finding text, urgency text, assessed_at timestamptz)
language sql stable
as $$
  select v.id, p.id, p.display_code, i.full_name, p.age, p.sex, v.token, v.status, v.checked_in_at,
         r.level, r.news2, r.findings -> 0 ->> 'title', r.assessment ->> 'urgency', r.assessed_at
  from visits v
  join patients p on p.id = v.patient_id
  left join patient_identity i on i.patient_id = p.id
  left join lateral (
    select * from risk_assessments ra where ra.visit_id = v.id order by ra.assessed_at desc limit 1
  ) r on true
  where v.visit_day = p_visit_day
  order by v.status = 'seen',
           case r.level when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
           v.token;
$$;

revoke execute on function triage_queue(date) from public, anon, authenticated;
