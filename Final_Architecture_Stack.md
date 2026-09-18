# 🏥 AI Clinical Scribe: Final Enterprise Architecture Stack

This document outlines the complete, end-to-end tech stack for the AI Clinical Scribe and Automated Peer Review System. 

**Core Engineering Philosophy:** High-Speed Dictation, Zero-Trust Privacy, and Modular Edge-Compute. By processing clinical dictation locally, we bypass standard HIPAA compliance hurdles associated with cloud computing.

---

## 📱 1. The Edge (Frontend & Audio Capture)
*   **Tech Stack:** Next.js (Web/PWA) or React Native (Mobile)
*   **Role:** The doctor's interface and Identity Manager. 
*   **Workflow:** The doctor selects the patient (loading the `patient_uuid`). Post-consultation, the doctor records a 30-60 second clinical summary. The app transmits this MP3 payload + UUID via a secure `multipart/form-data` POST request.

## ⚙️ 2. The Orchestrator (Backend API)
*   **Tech Stack:** Python + FastAPI
*   **Role:** The isolated, secure environment where all data processing occurs.
*   **Workflow:** Receives the MP3 and UUID, holds them in memory (ephemeral processing), and orchestrates the STT, Privacy, and AI pipelines. Raw audio is never written to a hard drive.

## 🎙️ 3. Speech-to-Text (The Dictation Engine)
*   **Tech Stack:** NVIDIA NeMo Parakeet
*   **Model Size:** `Parakeet Unified EN 0.6B` (English-only, highly optimized for blazing fast inference)
*   **Role:** Converts the doctor's clear, single-speaker dictation into text.
*   **Why it's bulletproof:** Parakeet is lighter, faster, and more accurate than Whisper for pure English dictation. It bypasses complex speaker diarization and provides near-instantaneous transcription latency.

## 🛡️ 4. Privacy Layer (The Safety Net)
*   **Tech Stack:** Microsoft Presidio (Python NLP Library)
*   **Role:** Catching accidental PII slips.
*   **Workflow:** Although doctors are trained not to dictate patient names, this layer scans the transcript just in case, redacting any PII (Names, Addresses) and replacing them with safe tags (e.g., `<PERSON>`).

## 🧠 5. The RAG Memory System (Embeddings & DB)
*   **Embedding Model:** `sentence-transformers` (`BAAI/bge-small-en-v1.5`)
*   **Database:** Supabase + `pgvector` extension
*   **Role:** Gives the AI "long-term memory" of the patient.
*   **Workflow:** 
    1. Patient history is stored as vector embeddings.
    2. Before analyzing the new dictation, Supabase `pgvector` performs a semantic search to retrieve relevant past medical history for this specific `patient_uuid`.

## 🤖 6. The Intelligence (AI Overseer)
*   **Tech Stack:** `OpenBioLLM-14B` or `Llama-3-8B-Instruct` (Run locally with strict JSON schema enforcement)
*   **Role:** The clinical safety net and structuring engine.
*   **Workflow:** Processes the clean dictation alongside the patient's RAG history. It outputs a structured JSON (Symptoms, Prescriptions) and actively flags risks (e.g., "Doctor prescribed Drug A, but patient's history shows allergy to Drug A").
*   **Final Step:** FastAPI links this JSON back to the `patient_uuid` and saves it to Supabase.

---
**Summary for the Pitch:** We have built an incredibly fast, highly accurate clinical dictation system. The frontend handles identity, the backend translates voice to text flawlessly without diarization headaches, and the local AI cross-references the doctor's summary against the patient's history to act as an instant, zero-trust safety net.
