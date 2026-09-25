-- Lumen memory layer: search and permission functions. Run after 01_schema.sql. Safe to re-run.

-- 1. Hybrid search over one patient's memory: meaning (vector) + keywords (full text),
--    merged by reciprocal rank fusion. Recent doctor notes get a small bonus.
create or replace function search_patient_memory(
  query_text      text,
  query_embedding vector(384),
  p_patient_id    uuid,
  match_count     int   default 8,
  rrf_k           int   default 50,
  recent_days     int   default 30,
  recent_bonus    float default 0.005
)
returns table (id bigint, tier text, source_id uuid, section text, content text,
               recorded_at timestamptz, similarity float, keyword_rank float, score float)
language sql stable
as $$
  with by_meaning as (
    select m.id,
           row_number() over (order by m.embedding <=> query_embedding) as r,
           1 - (m.embedding <=> query_embedding) as similarity
    from memory_chunks m
    where m.patient_id = p_patient_id
    order by m.embedding <=> query_embedding
    limit match_count * 4
  ),
  by_keyword as (
    select m.id,
           row_number() over (order by ts_rank_cd(m.fts, q) desc) as r,
           ts_rank_cd(m.fts, q) as rank
    from memory_chunks m, websearch_to_tsquery('english', query_text) q
    where m.patient_id = p_patient_id and m.fts @@ q
    order by rank desc
    limit match_count * 4
  )
  select m.id, m.tier, m.source_id, m.section, m.content, m.recorded_at,
         coalesce(s.similarity, 1 - (m.embedding <=> query_embedding)) as similarity,
         coalesce(k.rank, 0) as keyword_rank,
         coalesce(1.0 / (rrf_k + s.r), 0) + coalesce(1.0 / (rrf_k + k.r), 0)
           + case when m.tier = 'doctor' and m.recorded_at > now() - make_interval(days => recent_days)
                  then recent_bonus else 0 end as score
  from by_meaning s
  full outer join by_keyword k on k.id = s.id
  join memory_chunks m on m.id = coalesce(s.id, k.id)
  order by score desc
  limit match_count;
$$;

-- 2. "Find patients with a similar case" across the whole clinic (best-matching chunk per patient)
create or replace function find_similar_patients(query_embedding vector(384), match_count int default 5)
returns table (patient_id uuid, display_code text, similarity float, best_match text)
language sql stable
as $$
  select p.id, p.display_code, best.similarity, best.content
  from (
    select distinct on (m.patient_id)
           m.patient_id, m.content, 1 - (m.embedding <=> query_embedding) as similarity
    from memory_chunks m
    order by m.patient_id, m.embedding <=> query_embedding
  ) best
  join patients p on p.id = best.patient_id
  order by best.similarity desc
  limit match_count;
$$;

-- 3. The doctor wipes their own notes for one patient and falls back to clinic data only
create or replace function clear_doctor_memory(p_patient_id uuid)
returns int
language plpgsql
as $$
declare n int;
begin
  delete from memory_chunks where patient_id = p_patient_id and tier = 'doctor';
  delete from doctor_notes where patient_id = p_patient_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 4. The only way to remove a patient from the clinic tier: a logged-in receptionist.
--    Runs with the function owner's rights, but checks the caller's role from their login token.
create or replace function receptionist_delete_patient(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'receptionist' then
    raise exception 'Only a receptionist can delete clinic records';
  end if;
  -- Who deleted whom stays behind in audit_log (05_safety_fixes.sql), which has no foreign key to patients
  insert into audit_log (actor, action, patient_code, detail)
  select coalesce(auth.jwt() ->> 'email', auth.uid()::text, 'unknown'), 'patient_deleted', p.display_code,
         jsonb_build_object('patient_id', p.id,
                            'clinic_records', (select count(*) from clinic_records c where c.patient_id = p.id),
                            'doctor_notes',   (select count(*) from doctor_notes d where d.patient_id = p.id))
  from patients p where p.id = p_patient_id;
  delete from patients where id = p_patient_id;   -- cascades to every table except audit_log
end;
$$;

revoke execute on function receptionist_delete_patient(uuid) from public, anon, service_role;
grant  execute on function receptionist_delete_patient(uuid) to authenticated;
