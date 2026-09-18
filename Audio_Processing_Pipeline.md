# Architecture: Audio Capture to Vetted Transcript

This document outlines the first half of the data pipeline for the AI Clinical Scribe project. 
**Core Philosophy:** Zero-Trust, 100% Local Data Residency for maximum HIPAA compliance. Patient audio never touches a third-party cloud.

## 1. Mobile App (Audio Capture)
*   **Role:** The edge entry point for the system.
*   **Action:** The doctor uses a custom mobile application to record the patient consultation. 
*   **Tech Stack:** React Native, Flutter, or Next.js PWA.
*   **Security/Privacy Pitch:** 
    *   The app records audio directly into the device's RAM. 
    *   It generates an MP3 file.
    *   **Crucial:** We do *not* use native voice memo apps to avoid automatic syncing to consumer clouds (iCloud/Google Drive), preventing early HIPAA violations.

## 2. API Transmission
*   **Role:** Secure transport layer.
*   **Action:** The mobile app sends the MP3 payload via a secure `POST` request to our self-hosted backend.
*   **Format:** `multipart/form-data` upload.

## 3. Self-Hosted Backend (The Orchestrator)
*   **Role:** The secure, isolated environment where all audio processing occurs.
*   **Tech Stack:** Python + FastAPI.
*   **Security/Privacy Pitch:** FastAPI receives the audio file and holds it purely in memory. The file is *never* written to a physical hard drive, database, or external S3 bucket.

## 4. Local Speech-to-Text (STT) Engine
*   **Role:** Transcribing complex medical jargon accurately on local hardware.
*   **Tech Stack:** **`faster-whisper`** (OpenAI Whisper optimized with CTranslate2).
*   **Specs Locked In:** 
    *   **Model:** `small.en`
    *   **Parameter Size:** 244 Million Parameters
    *   **Resource Utilization:** Approx. 850 MB VRAM/RAM (Highly efficient for edge/local deployments).
    *   **Context Window:** Processes audio in 30-second sliding windows, passing context forward to maintain accurate medical terminology across long consultations.
*   **The Pitch:** By running the STT model locally inside our FastAPI environment, we guarantee 100% data residency. Zero audio bytes leave the private network.

## 5. Local Privacy Scrubbing (The Vetting Process)
*   **Role:** Ensuring the transcript is HIPAA-compliant before any external AI analysis.
*   **Action:** The raw text transcript returned by `faster-whisper` is instantly passed through a Natural Language Processing (NLP) privacy filter.
*   **Tech Stack:** **Microsoft Presidio** (Python library running locally on the FastAPI server).
*   **How it Works:** 
    *   Presidio automatically detects Personally Identifiable Information (PII) such as patient names, phone numbers, addresses, and SSNs.
    *   It replaces them with generic tags (e.g., changing "Hi, I'm John Doe" to "Hi, I'm `<PERSON>`").
*   **Security/Privacy Pitch:** The data is fully scrubbed locally. Only when the audio is destroyed and the text is fully anonymized does it leave our secure boundary.

---
**Pipeline Output:** A highly accurate, fully anonymized text string ready to be safely transmitted to the core LLM (AI Overseer) for clinical insights.
