# Draft: Multilingual Ambient Listening Stack (Kannada + English)

## 1. Audio Capture (The Edge)
*   **Stack:** Next.js or React Web App.
*   **Workflow:** The microphone stays on for the entire 10-15 minute consultation. The app compresses the audio (to MP3/WebM) and sends it to the FastAPI backend.

## 2. STT, Language ID, & Diarization (The Heavy Lifter)
*   **Option A (Fastest for Hackathon/API):** **Sarvam AI API** or **Bhashini API**. Sarvam is explicitly built for Indian language code-switching (Kannada + English). 
*   **Option B (Open Source/Local):** **WhisperX**. Combines `Whisper large-v3` with `pyannote.audio` for speaker diarization.
*   **Output:** Diarized transcript (e.g., `[Speaker 1]: ...`, `[Speaker 2]: ...`).

## 3. Translation & Medical Extraction (The Central Brain)
*   **Stack:** `Gemini 1.5 Flash` or `GPT-4o-mini` (Cloud) OR `Llama-3-8B-Instruct` (Local).
*   **Workflow:** Prompt the LLM to identify the Doctor/Patient, translate Kannada to English medical terms, and output a structured JSON (Symptoms, Patient History, Prescriptions).

## 4. Privacy Layer (The Scrubber)
*   **Stack:** Microsoft Presidio.
*   **Workflow:** Scan the translated English JSON to scrub out names/PII before long-term storage.

## 5. RAG Database Integration
*   **Stack:** Supabase + `pgvector` (or ChromaDB for quick local setup).
*   **Workflow:** The scrubbed JSON summary is converted into vector embeddings (`BAAI/bge-small-en-v1.5`) and saved to the database under the `patient_uuid`.

**Hackathon Note:** Use APIs (Sarvam/AssemblyAI) for transcription/diarization to save time and hardware resources unless a powerful GPU is available.
