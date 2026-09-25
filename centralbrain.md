# 🧠 Central Brain (AI Overseer) Architecture

This document details the core intelligence engine for the AI Clinical Scribe and Dashboard system. The "Central Brain" is responsible for parsing unstructured medical dictation, structuring it into a database, cross-referencing patient history, conducting web research, and acting as a clinical analytical assistant.

---

## 1. The Model Selection

### 🧪 Hackathon Demo Model (Local Edge)
*   **Model:** `aaditya/Llama3-OpenBioLLM-8B`
*   **Why:** It is a highly specialized medical LLM fine-tuned specifically for clinical reasoning and biomedical tasks. 
*   **Hardware Profile:** Easily runs on consumer hardware with **<16GB VRAM** (e.g., a standard gaming laptop or MacBook M-series) using 4-bit or 8-bit quantization via Ollama or vLLM. This proves the system can run locally for Zero-Trust Privacy.

### ☁️ Production Deployment Model (Cloud)
*   **Model:** `aaditya/Llama3-OpenBioLLM-70B`
*   **Why:** For the final deployed enterprise product, processing will be routed to this 70-billion parameter model on a HIPAA-compliant cloud instance (or a heavy local server cluster requiring ~48GB-140GB VRAM) for maximum reasoning depth and zero hallucinations.

---

## 2. Role & Iron-Clad Guardrails

**Core Philosophy:** The AI is an *Analytical Assistant*, **NOT** a Digital Doctor. It provides data summaries and literature research to assist clinical decision-making.

**Rules of Engagement (Enforced via Strict System Prompting & NeMo Guardrails):**
1.  **NO DIAGNOSIS:** The AI is forbidden from suggesting diagnoses, recommending treatments, or offering medical opinions.
2.  **NO MANIPULATION:** It must never guide the doctor toward a specific medical decision.
3.  **OPINION REJECTION:** If the doctor asks for a medical opinion via the dashboard (e.g., "What do you think is wrong?"), the AI will reject the request and reply: *"I am an analytical assistant and cannot provide medical opinions or diagnoses. I can only provide data summaries and literature research."*
4.  **ANALYTICS ONLY:** Outputs strictly focus on summarizing symptoms, mapping timelines, highlighting potential risk factors based on history, and citing recent pharmacological research.

---

## 3. The Orchestration Workflow

A raw LLM cannot execute this pipeline alone. The Central Brain relies on an orchestration framework (like **LangChain** or **LlamaIndex**) to operate as an Agent.

### The Step-by-Step Pipeline
1.  **Ingestion:** LangChain receives the transcribed text (from the local Parakeet 0.6B audio engine).
2.  **Memory Retrieval (RAG):** The Agent queries the Vector Database (Supabase `pgvector`) to scan the patient's historical records. It looks for recurring symptoms, causes, lifestyle risks, and past prescribed courses of action.
3.  **Active Web Research:** If the dictation mentions a new medication or a complex symptom, the Agent uses a web search tool (e.g., **Tavily Search API**) to research the latest FDA warnings, side effects, or medical literature.
4.  **Synthesis & Structuring:** OpenBioLLM-8B processes all this context. It automatically appends/formats the new data into a strict JSON schema.
5.  **Dashboard Presentation:** The JSON is rendered on the doctor's dashboard. 
6.  **Interactive Q&A:** When the doctor opens the dashboard, they can query the Central Brain (e.g., *"When was this symptom occurring?"* or *"What course did I suggest last time?"*). The AI answers based strictly on the RAG data without diagnosing.

---

**Summary:** OpenBioLLM-8B acts as the intelligent router. It organizes data, pulls historical context, researches drugs, and structures the medical note, completely automating the administrative burden while leaving 100% of the medical decision-making to the human doctor.
