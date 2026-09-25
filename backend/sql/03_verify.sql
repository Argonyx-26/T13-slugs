-- Run after 01, 02, 04, 05 and 06. Expected: 11 tables (rls_on = true), 13 functions, no ANN index, and every
-- "backend can ..." row = false.
select 'table' as kind, c.relname as name, 'rls_on=' || c.relrowsecurity::text as detail
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('patients', 'clinic_records', 'doctor_notes', 'doctor_hidden_patients', 'memory_chunks',
                    'patient_identity', 'visits', 'clinic_record_retractions', 'audit_log',
                    'vital_signs', 'risk_assessments')
union all
select 'function', p.proname, case when p.prosecdef then 'security definer' else '' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('search_patient_memory', 'find_similar_patients', 'clear_doctor_memory', 'receptionist_delete_patient',
                    'check_in', 'register_patient', 'search_patients', 'visit_queue', 'retract_clinic_record',
                    'active_clinic_records', 'find_possible_duplicates', 'delete_doctor_note', 'triage_queue')
union all
select 'backend can ' || lower(priv) || ' ' || t, '', has_table_privilege('service_role', 'public.' || t, priv)::text
from unnest(array['patients', 'clinic_records', 'clinic_record_retractions', 'audit_log', 'vital_signs',
                   'risk_assessments']) as t,
     unnest(array['UPDATE', 'DELETE']) as priv
union all
select 'ann index (should be absent)', indexname, 'present!' from pg_indexes
where tablename = 'memory_chunks' and (indexdef ilike '%using hnsw%' or indexdef ilike '%using ivfflat%')
order by 1, 2;
