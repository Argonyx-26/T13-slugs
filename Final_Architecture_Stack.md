# 🏥 AI Clinical Scribe: Final Enterprise Architecture Stack

This document outlines the complete, end-to-end tech stack for the AI Clinical Scribe and Automated Peer Review System. 

**Core Engineering Philosophy:** Zero-Trust Privacy, Edge-Compute Capable, and Modular. By processing audio and PHI (Protected Health Information) locally, we completely bypass standard HIPAA compliance hurdles associated with cloud computing.

---

## 📱 1. The Edge (Frontend & Audio Capture)
*   **Tech Stack:** Next.js (Web/PWA) or React Native (Mobile)
*   **Role:** The doctor's interface. 
*   **Workflow:** Records the consultation directly to device RAM and transmits an MP3 payload via a secure `multipart/form-data` POST request to our self-hosted backend. *No native voice memo apps are used to prevent unauthorized cloud backups.*

## ⚙️ 2. The Orchestrator (Backend API)
*   **Tech Stack:** Python + FastAPI
*   **Role:** The isolated, secure environment where all data processing occurs.
*   **Workflow:** Receives the MP3, holds it in memory (ephemeral processing), and orchestrates the STT, Privacy, and AI pipelines. Raw audio is never written to a hard drive.

## 🎙️ 3. Speech-to-Text (The Audio Pipeline)
*   **Tech Stack:** `faster-whisper` (OpenAI Whisper optimized via CTranslate2)
*   **Model Size:** `small.en` (244M parameters, ~850MB RAM)
*   **Role:** Converts audio to raw text locally.
*   **Why it's bulletproof:** Uses a 30-second sliding context window to maintain medical context over long consultations. 100% local execution guarantees zero audio bytes leave the private network.

## 🛡️ 4. Privacy Layer (The Scrubber)
*   **Tech Stack:** Microsoft Presidio (Python NLP Library)
*   **Role:** Anonymizes the transcript.
*   **Workflow:** Instantly scans the raw text from `faster-whisper` and redacts all PII (Names, SSNs, Addresses) replacing them with safe tags (e.g., `<PERSON>`).

## 🧠 5. The RAG Memory System (Embeddings & DB)
*   **Embedding Model:** `sentence-transformers` (`BAAI/bge-small-en-v1.5`)
*   **Database:** Supabase + `pgvector` extension
*   **Role:** Gives the AI "long-term memory" of the patient.
*   **Workflow:** 
    1. The local, open-source embedding model converts patient history and current symptoms into vector math (avoiding third-party APIs).
    2. Supabase stores both standard relational data (Patient profiles) and the vector embeddings.
    3. During a consultation, `pgvector` performs a semantic search to retrieve relevant past medical history based on the current conversation.

## 🤖 6. The Intelligence (AI Overseer)
We utilize a single, highly specialized open-source model to ensure maximum privacy, operating entirely within our secure infrastructure.

*   **The Local Clinical Brain**
    *   **Tech Stack:** `OpenBioLLM-14B` (Run locally with strict JSON schema enforcement)
    *   **Role:** A highly specialized, medical-grade LLM that acts as the sole brain of the system. It processes the scrubbed transcript and RAG context entirely on the local server. It performs clinical extraction, symptom mapping, and risk analysis without any data leaving the firewall, proving our Zero-Trust architecture for the hackathon demo.

---
**Summary for the Pitch:** We have built a system where the "listening" and "scrubbing" are done at the edge (zero trust), the "memory" is semantic (Supabase pgvector), and the "brain" is a fully localized, specialized medical model (OpenBioLLM-14B) ensuring absolutely no PHI leaves the clinic's secure network.
