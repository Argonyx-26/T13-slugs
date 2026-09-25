-- DANGER: deletes every memory-layer table, function and row in this Supabase project.
-- Only for starting over in an existing project. Afterwards run 01, 02, 04, 05, 06, 03, then `python -m rag.seed`.
-- Login accounts (Authentication > Users) are not touched; `python -m rag.setup_users --recreate` handles them.

drop function if exists search_patient_memory, find_similar_patients, clear_doctor_memory,
                        receptionist_delete_patient, check_in, register_patient, search_patients,
                        visit_queue, retract_clinic_record, active_clinic_records, find_possible_duplicates,
                        delete_doctor_note, triage_queue, match_patient_chunks, hybrid_patient_chunks,
                        match_similar_patients, reset_doctor_memory;

drop table if exists risk_assessments, vital_signs, audit_log, clinic_record_retractions, visits, patient_identity, memory_chunks, doctor_hidden_patients, doctor_notes, clinic_records,
                     patients, rag_chunks, doctor_archived_patients cascade;
