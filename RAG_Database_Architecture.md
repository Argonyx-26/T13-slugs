# 🗄️ Dual-Database RAG Architecture

This document outlines the database strategy for the AI Clinical Scribe. The core philosophy is **Non-Destructive Augmentation**: the application acts as a personal productivity tool for the doctor, ensuring the clinic's primary electronic health record (EHR) system remains untouched and pristine.

---

## 1. The Dual-Database Concept

To provide the most accurate assistance without stepping on the toes of the clinic's IT staff or receptionist, the system utilizes a two-tier database approach:

### 🏛️ Tier 1: The Clinic's Existing Database (Ground Truth)
*   **Role:** The official source of truth for the patient (demographics, official labs, billing, front-desk intake).
*   **Access Level:** **Strictly Read-Only**. 
*   **Action:** Our system periodically pulls data from this database and converts the patient's medical history into vector embeddings. 

### 📓 Tier 2: The Doctor's Personal Database (Dynamic Memory)
*   **Role:** The doctor's private workspace. It stores the AI-generated dictation summaries, the doctor's personal late-night notes, off-the-cuff observations, and new symptom tracking.
*   **Access Level:** **Read & Write**.
*   **Action:** When the doctor uses the app or dictates a note, the data is saved *only* here. It never overwrites the Clinic's DB. 

---

## 2. The Unified RAG Vector Engine

Even though the data lives in two different mental spaces (Official vs. Personal), the **Central Brain (OpenBioLLM-8B)** needs to search both simultaneously to provide complete analytical assistance.

### How it Works:
1.  **Embedding:** Data from *both* Tier 1 (Clinic DB) and Tier 2 (Doctor's DB) is passed through an embedding model (e.g., `BAAI/bge-small-en-v1.5`) and stored in a single Vector Database.
2.  **Metadata Tagging:** Every piece of information in the Vector Database is tagged with metadata. 
    *   `source: clinic_db`
    *   `source: doctor_personal_notes`
3.  **Retrieval:** When the AI analyzes a new dictation, it queries the Vector DB. It can instantly cross-reference a new symptom noted by the doctor against an old blood test from the clinic's DB.

---

## 3. The Failsafe Advantage

This architecture provides a massive safety net:
*   **Zero IT Conflict:** Clinic IT staff don't have to worry about the AI accidentally overwriting official prescriptions or deleting patient records.
*   **Revertible State:** If the doctor's personal notes become cluttered, incorrect, or corrupted, the system can simply wipe the doctor's RAG entries for that patient and revert to relying solely on the pristine, accurate data from the Clinic's DB.

---

## 4. Recommended Tech Stack (For Hackathon)

To build this quickly in a 24-hour hackathon, use the following stack:

*   **Mock Clinic DB:** A simple **SQLite** database containing dummy patient records (Name, Age, Past Visits).
*   **Doctor's Personal DB:** **SQLite** or **MongoDB** (to easily store the JSON outputs from the LLM).
*   **The RAG Vector Store:** **ChromaDB** or **Qdrant**. Both can be run locally via Python in seconds. They will hold the vectorized chunks of text from *both* databases, utilizing metadata filtering to know where the data came from.

---

## 5. Enterprise Bulletproofing (Edge Case Solutions)

To make this architecture robust for real-world clinic deployment (and to impress the judges), we have implemented strict rules for data conflicts, syncing, and compliance:

### A. The Contradiction Rule (Priority Routing)
*   **The Problem:** The Clinic DB might have outdated information (e.g., "No allergies") while the doctor recently discovered a new issue (e.g., "Allergic to Penicillin").
*   **The Solution:** We implement a **Precedence Hierarchy** in the RAG retrieval logic. Any personal note dictated by the doctor within the last 30 days is given a higher relevance score (or absolute precedence) over older official clinic data. The AI will explicitly state: *"Based on your recent notes, patient is allergic to Penicillin, overriding older clinic data."*

### B. The Nightly Sync (Handling Lag)
*   **The Problem:** Clinic staff (receptionists/nurses) might update the Clinic DB during the day.
*   **The Solution:** The embedding model runs an automated **Nightly Batch Job**. Every night at 2:00 AM, it pulls any new updates from the Clinic DB and re-embeds them into the Unified RAG Vector Store. When the doctor opens the app the next morning, they have the freshest clinical data seamlessly merged with their personal notes.

### C. Cascading Data Deletion (HIPAA/Compliance)
*   **The Problem:** If a patient requests their data be deleted, or the clinic officially purges a record, our AI cannot legally hold onto the "Personal DB" fragments.
*   **The Solution:** We enforce a **Cascading Deletion Rule**. The RAG Vector Store uses the `patient_uuid` as the primary key constraint for metadata. If a `DELETE` webhook is received from the main Clinic DB, the RAG engine instantly purges all vector chunks (both official and personal notes) associated with that `patient_uuid` to maintain strict compliance.
