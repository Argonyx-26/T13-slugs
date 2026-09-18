# Architecture: Audio Dictation to AI Analysis Pipeline

This document outlines the data pipeline for the Intelligent Clinical Dictation System. 
**Core Philosophy:** Maximum reliability, low-latency processing, and Zero-Trust Data Residency. By shifting from ambient room recording to post-consultation doctor dictation, we eliminate speaker diarization errors, translation hallucinations, and background noise corruption.

## 1. Mobile App / Edge (The Dictation Interface)
*   **Role:** The edge entry point for the system and identity management.
*   **Workflow:** 
    1. The doctor selects the patient's profile *before* or *after* the consultation, loading the `patient_uuid` into the app.
    2. The consultation happens naturally (no recording).
    3. Once the patient leaves, the doctor hits "Record" and dictates a 30-60 second clinical summary in English.
*   **Action:** The app records the dictation directly into the device's RAM, generating an MP3 file.
*   **Tech Stack:** Next.js PWA, React Native, or Flutter.

## 2. API Transmission
*   **Role:** Secure transport layer.
*   **Action:** The mobile app sends a secure `POST` request to our self-hosted backend.
*   **Format:** `multipart/form-data` upload.
*   **Payload:** The MP3 dictation file AND the `patient_uuid`.

## 3. Self-Hosted Backend (The Orchestrator)
*   **Role:** The isolated environment where all audio processing occurs.
*   **Tech Stack:** Python + FastAPI.
*   **Workflow:** FastAPI holds the MP3 and `patient_uuid` purely in RAM. It orchestrates the pipeline sequentially without writing raw audio to a physical disk.

## 4. Local Speech-to-Text (The Audio Engine)
*   **Role:** Transcribing clear, single-speaker medical dictation with extreme speed and accuracy.
*   **Tech Stack:** **`faster-whisper`** (Optimized with CTranslate2).
*   **Specs:** 
    *   **Model:** `small.en` or `medium.en` (English-only models).
    *   **Why it's flawless:** Because the input is a single, clear voice speaking English close to a microphone, the STT will achieve near 100% accuracy. We completely bypass the need for heavy speaker diarization (WhisperX) or complex translation alignments. 
    *   **Resource Utilization:** Highly efficient (~850MB to 1.5GB VRAM), capable of running on standard edge hardware instantly.

## 5. Local Privacy Safety Net
*   **Role:** Catching accidental slips. Doctors are trained not to dictate PII, but humans make mistakes.
*   **Tech Stack:** **Microsoft Presidio** (Python NLP library).
*   **Action:** A fast safety scan of the English transcript. If the doctor accidentally dictates, "John came in today with...", Presidio instantly scrubs "John" to `<PERSON>`.

## 6. AI Processing & Database Re-Linking
*   **Role:** Structuring the raw dictation and mapping it to the database.
*   **Workflow:**
    1. FastAPI sends the clean dictation transcript to the local AI Overseer (LLM).
    2. The LLM converts the unstructured paragraph into a structured JSON medical record (Symptoms, Diagnosis, Prescriptions).
    3. *Crucial:* The LLM performs active analysis (e.g., checking the dictated prescriptions against the patient's historical RAG data for drug interactions or flagging if the doctor forgot to mention ordering a vital lab test).
    4. FastAPI attaches the `patient_uuid` to this JSON and saves it to the database.

---
**Pipeline Output:** A perfectly accurate, structured clinical note with AI-generated risk alerts, instantly mapped to the correct patient profile.
