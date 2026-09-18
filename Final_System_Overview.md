# 🏥 AI Clinical Scribe & Automated Peer Review System

## 🌟 System Overview
The AI Clinical Scribe is a high-speed, safety-first clinical analytical assistant designed to solve clinical burnout and data overload. Unlike conventional "ambient listening" scribes that attempt to record entire consultations (and fail in noisy environments), this system relies on **post-consultation dictation**. 

By allowing the doctor to dictate a 30-60 second clinical summary in English, the system guarantees near 100% audio clarity, zero speaker confusion, and sub-3-second processing speeds. It acts as an **Analytical Safety Net**—cross-referencing the doctor's dictation against the patient's entire medical history to flag omissions or drug interactions, without ever acting as a "digital doctor" or making diagnoses itself.

---

## 🏗️ Architecture & Tech Stack

The architecture is built on the philosophy of **Zero-Trust Privacy, Modular Edge-Compute, and Non-Destructive Augmentation**.

### 1. The Edge (Frontend & Audio Capture)
*   **Tech Stack:** Next.js (Web/PWA) or React Native / Flutter (Mobile)
*   **Role:** The doctor's dictation interface and Identity Manager.
*   **Workflow:** The doctor selects a patient profile (loading the `patient_uuid`). Post-consultation, the doctor dictates a 30-60 second summary. The app records this to RAM (generating an MP3) and sends a secure POST request (`multipart/form-data`) with the MP3 and UUID to the backend.

### 2. The Orchestrator (Backend API)
*   **Tech Stack:** Python + FastAPI
*   **Role:** The isolated, secure environment where all audio processing and AI orchestration occurs.
*   **Workflow:** Holds the MP3 and `patient_uuid` ephemerally in RAM. It orchestrates the entire pipeline sequentially without writing raw audio to a physical disk.

### 3. Speech-to-Text (The Dictation Engine)
*   **Tech Stack:** NVIDIA NeMo Parakeet
*   **Model:** `Parakeet Unified EN 0.6B` (State-of-the-art English model)
*   **Role:** Converts the single-speaker medical dictation into text with sub-second latency, bypassing the need for complex speaker diarization.

### 4. Privacy Layer (The Safety Net)
*   **Tech Stack:** Microsoft Presidio (Python NLP Library)
*   **Role:** On-device anonymization to catch accidental PII slips. It scrubs the text (e.g., changing a patient's name to `<PERSON>`) before the AI sees it.

### 5. Dual-Database RAG Memory System (Embeddings & DB)
*   **Embedding Model:** `sentence-transformers` (`BAAI/bge-small-en-v1.5`)
*   **Database:** Supabase + `pgvector` (or ChromaDB / Qdrant for local/hackathon deployments).
*   **Role:** Provides "long-term memory" of the patient without risking the clinic's primary EHR system.
*   **Workflow:** 
    *   **Tier 1 (Clinic DB):** Read-only ground truth database (demographics, official labs).
    *   **Tier 2 (Doctor's DB):** Read/write private workspace for AI-generated summaries and personal notes.
    *   Data from both tiers is embedded into a unified Vector DB with source tags. Semantic search is performed to retrieve past medical history for the specific `patient_uuid`.

### 6. The Central Brain (AI Overseer)
*   **Tech Stack:** `aaditya/Llama3-OpenBioLLM-8B` (Local Edge) or `aaditya/Llama3-OpenBioLLM-70B` (Cloud). Orchestrated via LangChain or LlamaIndex.
*   **Role:** The clinical safety net and structuring engine. 
*   **Workflow:** Processes the clean dictation alongside the patient's RAG history. Outputs structured JSON (Symptoms, Prescriptions) and actively flags risks (e.g., drug interactions or omissions) based on historical data and live web research (e.g., Tavily Search API). The AI operates strictly under rules to **never** diagnose or recommend treatments.

---

## 🛡️ Competitive Moat

1.  **Post-Consultation Dictation over Ambient Listening:** Solves the "Noisy Clinic" flaw. 100% audio clarity, no multi-speaker hallucination, and instant processing speeds compared to ambient listeners that take minutes to process.
2.  **Dual-Database RAG Architecture:** Bypasses IT integration nightmares. The system does not write to or overwrite the clinic’s master EHR database. It acts as a lightweight, private overlay for the doctor.
3.  **Strict Liability Safeguards:** Combats "Automation Complacency." The AI is hardcoded to refuse medical opinions or diagnoses, acting purely as an analytical safety net that cross-references data to catch human errors, avoiding the massive medical liability of a "robot doctor."
