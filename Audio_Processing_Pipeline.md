# Architecture: Audio Capture to Vetted Transcript

This document outlines the first half of the data pipeline for the AI Clinical Scribe project. 
**Core Philosophy:** Zero-Trust, 100% Local Data Residency for maximum HIPAA compliance. Patient audio never touches a third-party cloud.

## 1. Mobile App / Edge (Audio Capture & Identity)
*   **Role:** The edge entry point for the system and identity management.
*   **Workflow (Patient-First):** The doctor selects an existing patient or creates a new one *before* recording. This loads a unique `patient_uuid` into the app's memory. 
*   **Action:** The doctor records the consultation directly into the device's RAM, generating an MP3 file.
*   **Tech Stack:** React Native, Flutter, or Next.js PWA.
*   **Security/Privacy Pitch:** We do *not* use native voice memo apps to avoid automatic syncing to consumer clouds (iCloud/Google Drive). 

## 2. API Transmission
*   **Role:** Secure transport layer.
*   **Action:** The mobile app sends a secure `POST` request to our self-hosted backend.
*   **Format:** `multipart/form-data` upload.
*   **Crucial Payload:** The payload contains *both* the MP3 file AND the `patient_uuid`.

## 3. Self-Hosted Backend (The Orchestrator)
*   **Role:** The secure, isolated environment where all audio processing occurs.
*   **Tech Stack:** Python + FastAPI.
*   **Security/Privacy Pitch:** FastAPI receives the payload and holds the MP3 and `patient_uuid` purely in memory. The raw audio is *never* written to a physical hard drive, database, or external S3 bucket.

## 4. Local Speech-to-Text & Diarization (The Audio Engine)
*   **Role:** Transcribing multilingual medical jargon and identifying speakers accurately on local hardware.
*   **Tech Stack:** **WhisperX** (A pipeline orchestrating `faster-whisper` and `pyannote.audio`).
*   **Specs Locked In:** 
    *   **Model:** `medium` or `large-v3-turbo` (Requires ~1.5GB+ VRAM but crucial for regional language accuracy).
    *   **Multilingual Translation:** Runs with `task="translate"`. It automatically detects regional languages (like Kannada) or code-mixed audio and outputs a standardized **English** transcript in one pass.
    *   **Speaker Diarization:** Uses `pyannote.audio` under the hood to map out exactly who is speaking, outputting segmented text (e.g., `Speaker A` vs `Speaker B`). This solves the "noisy Indian clinic" overlapping voice problem.

## 5. Local Privacy Scrubbing (The Vetting Process)
*   **Role:** Ensuring the transcript is HIPAA-compliant before any external AI analysis.
*   **Action:** The raw, diarized English transcript is instantly passed through a Natural Language Processing (NLP) privacy filter.
*   **Tech Stack:** **Microsoft Presidio** (Python library running locally on the FastAPI server).
*   **How it Works:** Presidio automatically detects Personally Identifiable Information (PII) such as patient names, phone numbers, and locations, replacing them with generic tags (e.g., `<PERSON>`).

## 6. AI Processing & Database Re-Linking
*   **Role:** Extracting clinical value and mapping it back to the correct patient without exposing PII.
*   **Workflow:**
    1. The Orchestrator sends the *anonymized* `Speaker A/B` transcript to the AI Overseer (LLM).
    2. The LLM uses a strict prompt to deduce which speaker is the Doctor vs. Patient and extracts the clinical summary and risk flags into a JSON object.
    3. The Orchestrator receives this JSON, retrieves the `patient_uuid` it was holding in RAM, attaches it to the JSON, and writes it directly to the database.
*   **The Pitch:** The AI model never sees the patient's real name, guaranteeing privacy. The database remains perfectly organized because the Orchestrator safely bridges the gap.

---
**Pipeline Output:** A highly accurate, speaker-diarized, fully anonymized text string mapped flawlessly to a database UUID, ready for the core AI Overseer.
