# Draft: Multilingual Ambient Listening Stack (Kannada + English)

## 1. Audio Capture (The Edge)
*   **Stack:** Next.js or React Web App.
*   **Workflow:** The microphone stays on for the entire 10-15 minute consultation. The app compresses the audio (to MP3/WebM) and sends it to the FastAPI backend.

## 2. STT, Language ID, & Diarization (The Heavy Lifter)
*   **Selected Stack:** **WhisperX** (Open Source) running on Podman GPU containers.
*   **Why WhisperX?**
    *   **STT Engine:** Uses `openai/whisper-large-v3`, which leverages massive multilingual training data to gracefully handle rapid Kannada-English code-switching.
    *   **Context Preservation:** We will use an `initial_prompt` to bias the model towards medical context and expect Kanglish.
    *   **Diarization:** Natively wraps `pyannote.audio` for precise speaker labels (`SPEAKER_00`, `SPEAKER_01`) and word-level timestamps.
    *   **Performance:** Runs via `faster-whisper` (CTranslate2), making it incredibly fast and memory-efficient on rented GPUs.
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

**Hackathon Note:** We have opted for a 100% Free & Open Source (FOSS) self-hosted architecture via rented GPUs in Podman. This guarantees Zero-Trust privacy for clinical audio and avoids recurring third-party API costs.
