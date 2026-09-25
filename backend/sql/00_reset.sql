-- DANGER: deletes every memory-layer table, function and row in this Supabase project.
-- Only for starting over in an existing project. Afterwards run 01, 02, 03, then `python -m rag.seed`.
-- Login accounts (Authentication > Users) are not touched; `python -m rag.setup_users --recreate` handles them.

drop function if exists search_patient_memory, find_similar_patients, clear_doctor_memory,
                        receptionist_delete_patient, match_patient_chunks, hybrid_patient_chunks,
                        match_similar_patients, reset_doctor_memory;

drop table if exists memory_chunks, doctor_hidden_patients, doctor_notes, clinic_records, patients,
                     rag_chunks, doctor_archived_patients cascade;
