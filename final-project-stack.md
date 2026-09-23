# 🏥 AI Clinical Scribe: Final Project Stack (Ambient & Multilingual)

This document serves as the single source of truth for the entire tech stack, architecture, and data pipeline of the AI Clinical Scribe system. It aggregates the frontend, audio processing, backend orchestration, AI intelligence, and RAG database architecture into one unified view.

## 🌟 System Overview & Core Philosophy
The AI Clinical Scribe is a safety-first clinical analytical assistant designed to solve clinical burnout and data overload. By utilizing **multilingual ambient listening** for the entire consultation, the system captures natural conversation in both Kannada and English without disrupting the doctor's workflow. It acts as an **Analytical Safety Net**—cross-referencing the conversation against the patient's entire medical history to flag omissions or drug interactions, without ever acting as a "digital doctor" or making diagnoses itself.

## 🛡️ Competitive Moat & Safeguards
1.  **Multilingual Ambient Edge:** Solves the language barrier in regional clinics. Capable of handling rapid Kannada-English code-switching and automatically structuring it into standard English medical records.
2.  **Dual-Database RAG Architecture:** Bypasses IT integration nightmares. The system does not write to or overwrite the clinic’s master EHR database. It acts as a lightweight, private overlay for the doctor.
3.  **Strict Liability Safeguards:** Combats "Automation Complacency." The AI is hardcoded to refuse medical opinions or diagnoses, acting purely as an analytical assistant to avoid the massive medical liability of a "robot doctor."

## 🚀 1. Deployment & Infrastructure
*   **GPU Compute:** **RunPod** (Renting a single **24GB VRAM GPU**, such as an RTX 3090, RTX 4090, or A10G).
*   **Backend Hosting:** Self-hosted FastAPI server orchestrating the pipeline.
*   **VRAM Management Strategy:** To fit both the STT and the LLM into a strict 24GB VRAM budget without Out-Of-Memory (OOM) errors, the FastAPI orchestrator uses a sequential loading pipeline:
    1. Loads `WhisperX` into VRAM (~5GB).
    2. Processes audio and generates the transcript.
    3. Unloads `WhisperX` and loads the 32B LLM into VRAM (~18GB for 4-bit).
    4. Processes text and structures JSON.

## 📱 2. The Edge: Ambient Audio Capture (Mobile App & Web)
*   **Tech Stack:** Flutter (Mobile & Web).
*   **Role:** The doctor's interface and Identity Manager.
*   **Workflow:**
    1. The doctor selects the patient profile, loading the `patient_uuid`.
    2. The microphone stays **on for the entire 10-15 minute consultation**, capturing the natural, ambient conversation between the doctor and patient.
    3. The application compresses the audio (to MP3/WebM) and securely streams or POSTs it to the backend via `multipart/form-data`.

## 🎙️ 3. STT, Language ID, & Diarization (The Heavy Lifter)
*   **Tech Stack:** **WhisperX** (Open Source) running via Podman/Docker on RunPod.
*   **Role:** Transcribing and separating speakers in a bilingual environment.
*   **Why WhisperX?**
    *   **Multilingual STT:** Uses `openai/whisper-large-v3`, which handles rapid **Kannada-English code-switching** seamlessly.
    *   **Diarization:** Natively integrates `pyannote.audio` to distinguish between the doctor and patient (e.g., `SPEAKER_00`, `SPEAKER_01`) with precise word-level timestamps.
    *   **Output:** A diarized, raw bilingual transcript (Kannada + English mixed).

## 🧠 4. Translation & Medical Extraction (Central Brain)
*   **Tech Stack:** A **~32B parameter clinical LLM** (e.g., OpenBioLLM variants or a fine-tuned clinical model).
*   **Optimization:** Quantized to **4-bit (AWQ/EXL2/GGUF)** to maintain high reasoning capability while fitting inside the ~18GB available VRAM budget.
*   **Workflow:**
    1. Ingests the diarized Kannada/English transcript.
    2. Maps `SPEAKER_00` / `SPEAKER_01` to "Doctor" and "Patient".
    3. **Translates** all Kannada medical context into standardized English terminology.
    4. **Synthesizes** the 15-minute conversation into a highly structured JSON clinical note (Symptoms, History, Prescriptions, Action Items).

## 🛡️ 5. Privacy & Anonymization Layer (The Scrubber)
*   **Tech Stack:** Microsoft Presidio (Python NLP Library).
*   **Role:** The local safety net to catch accidental PII slips.
*   **Workflow:** Scans the final, translated English JSON summary and redacts any personally identifiable information (e.g., replacing names with safe tags like `<PERSON>`) before the data reaches the database.

## 🗄️ 6. RAG Database Architecture (Dual-Database System)
*   **Embedding Model:** `sentence-transformers` (`BAAI/bge-small-en-v1.5`).
*   **Vector Database:** Supabase with `pgvector` (or ChromaDB / Qdrant for local/hackathon).
*   **Traditional Databases:** SQLite / MongoDB (for personal notes), Clinic's existing EHR (read-only).
*   **Architecture Concept:**
    *   **Tier 1 (Clinic DB):** Read-only ground truth (demographics, official labs).
    *   **Tier 2 (Doctor's DB):** Read/write private workspace for the AI summaries.
*   **Workflow:**
    1. The scrubbed English JSON is embedded and stored in the Vector DB with `patient_uuid` metadata tags.
    2. During future visits, the Central Brain queries this Vector DB to give the AI "long-term memory" of the patient's history.
    3. The system handles conflicting data via strict precedence rules and complies with HIPAA through cascading data deletion linked to the UUID.
*   **Feature - Global Similarity Search:** If a doctor needs to research an old patient, their historical data is already resting in the Vector DB from their last visit and loads instantly. If they are looking for a similar case but forgot the name, our RAG architecture allows them to do a semantic search across the entire clinic's history to instantly find past patients with matching symptom vectors, which is something legacy SQL databases physically cannot do.
