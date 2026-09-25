-- Run after 01 and 02. Expected: 5 tables (rls_on = true), 4 functions, and every "backend can ..." row = false.
select 'table' as kind, c.relname as name, 'rls_on=' || c.relrowsecurity::text as detail
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('patients', 'clinic_records', 'doctor_notes', 'doctor_hidden_patients', 'memory_chunks')
union all
select 'function', p.proname, case when p.prosecdef then 'security definer' else '' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('search_patient_memory', 'find_similar_patients', 'clear_doctor_memory', 'receptionist_delete_patient')
union all
select 'backend can ' || lower(priv) || ' ' || t, '', has_table_privilege('service_role', 'public.' || t, priv)::text
from unnest(array['patients', 'clinic_records']) as t, unnest(array['UPDATE', 'DELETE']) as priv
order by 1, 2;
