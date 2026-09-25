# RAG Memory & Dual Engine: Research Notes

What we tested while building the patient-memory layer, what we found, and the design decisions those findings drove. The architecture itself is described in `RAG_Database_Architecture.md` (two tiers) and `VECTOR_DB_GUIDE.md` (how to run it). This document covers the **why**.

---

## 1. The question

The Central Brain needs the patient's history to catch omissions, drug interactions and allergy conflicts. Two constraints shape how we give it that history:

- **The context window is small.** OpenBioLLM-8B is built on Llama-3-8B, which reads 8,192 tokens at once. A 10-minute consult transcript takes roughly 2,500 of those (estimate), and the model also needs room for instructions and its JSON answer. A patient with years of visits can't be pasted in whole, so we have to **choose** what goes in.
- **Missing a record is worse than including an extra one.** This is a safety net: a missed allergy is a failure, but an irrelevant cold from three years ago is only noise.

## 2. The "dual engine" design

We ended up with two engines answering two different questions.

| Engine | Question it answers | How | Can it miss? |
|---|---|---|---|
| **Safety facts** | "What do we know for certain?" (allergies, diagnoses, current prescriptions) | Plain lookup by patient, **always** included | No: never ranked, never cut |
| **Hybrid search** | "Which past records relate to *today's* consult?" | Meaning (embeddings) + keywords (full-text search) over clinic records and approved doctor notes | Yes, which is why the safety facts don't depend on it |

Both run over the two tiers from `RAG_Database_Architecture.md`: the clinic's read-only records (Tier 1) and the doctor's own notes (Tier 2). Every result is tagged with its tier, so the doctor and the LLM know where each fact came from.

---

## 3. Experiment: does the embedding model connect symptoms to the right record?

**The showcase case:** a patient had a borderline HbA1c (6.2%) six months ago, recorded only in a lab note and never added to their conditions list. Today they say they're always thirsty and get up at night to urinate. Can search connect the two?

**Setup:** 8 realistic records for one patient, including a deliberately confusing one (an old urinary tract infection) and routine ones (a cold, a sprain, a vaccination). We searched with several phrasings and noted where the HbA1c note ranked (top 3 only; "—" = not in the top 3).

| Query | `BAAI/bge-small-en-v1.5` | `abhinand/MedEmbed-small-v0.1` |
|---|---|---|
| "excessive thirst" | #2 (a common-cold note was #1) | **#1** |
| "frequent urination at night" | — (UTI note #1) | — (UTI note #1) |
| "fatigue" | #3 | #2 |
| "I'm thirsty all the time and I get up at night to pee" | #3 | #2 |
| "polydipsia" | — | — |
| "polyuria and nocturia" | #2 | #3 |
| "increased thirst and urination, possible hyperglycaemia" | **#1** | **#1** |

**Findings**
1. **The general-purpose model is not reliable here.** bge-small ranked a common-cold note above the HbA1c note for "excessive thirst".
2. **MedEmbed-small is better but not reliable either.** It's bge-small fine-tuned for medical retrieval, with the same 384-number vectors, so it's a drop-in swap with no database change. We adopted it.
3. **Similarity scores are squashed together.** Everything landed between about 0.47 and 0.73, so "related" and "unrelated" records are only a few hundredths apart.
4. **A clinical rewording of the symptoms works best.** "Increased thirst and urination, possible hyperglycaemia" put the HbA1c note first with both models. Single medical terms alone ("polydipsia") did not.

**Decision:** switch to MedEmbed-small, and search with clinical rewordings as well as the patient's own words (next section).

---

## 4. Experiment: lay phrasing vs clinical rewording, on full patient histories

**Setup:** 5 synthetic patients, each with one planted issue among about 15 routine records (16–17 searchable records each). We searched with the consult's symptoms and medicines ("lay"), then added one clinical rewording of the consult ("lay + clinical"). Meaning-only ranking; rank of the planted record:

| Patient (planted record) | Lay | Lay + clinical |
|---|---|---|
| P-001 (asthma note: "avoid non-selective beta-blockers") | #5 | **#2** |
| P-002 (earlier sinusitis visit) | #2 | #2 |
| P-003 ("avoid NSAIDs while on warfarin") | #1 | #1 |
| P-004 (the HbA1c lab note) | #4 | **#2** |

We also compared three ways of combining several queries: reciprocal rank fusion, the best single score, and the average score. Rank fusion was the most consistent of the three.

**Decision:** the Brain's first pass should output English `symptoms`, `medications`, **and** a `clinical` rewording, and the memory layer searches with all three. The embedding models are English-only, so searching with raw Kannada-English transcript text isn't an option anyway.

---

## 5. Experiment: adding keyword search (hybrid)

Meaning search misses exact names; keyword search catches them. With Postgres full-text search added alongside the embeddings:

- "propranolol 40 mg" now hits the asthma note directly, because it names propranolol.
- The clinical rewording for P-004 contains "glucose" and "HbA1c", which hit the lab note as keywords.

**Problem found: generic words cause false keyword matches.**

| Query | Wrongly matched |
|---|---|
| "mild fever" | "**Mild** gastritis", "**Mild** neck strain" |
| "frequent urination at **night**" | "Cetirizine 10 mg at **night**" |
| "lower back pain for one **week**" | "Vitamin D… **weekly** for 8 weeks" (word stemming) |

**Decision:** leave words that describe *how* or *when* ("mild", "acute", "night", "week", "recurrent"…) out of the keyword query. Only words that describe *what* are used.

---

## 6. Experiment: how many results to pass on (the cutoff)

**Problem found:** on the live database, rank fusion gave every patient 6–7 "relevant" records, mostly filler. The prompt told the LLM a common-cold note was "related to" thirst. Rank fusion is too flat here: across a query's 12 results, the first scores only about 15% more than the twelfth, so no cutoff on it removes anything.

**New scoring: how much does a record stand out?** For each query, take the median similarity of its results as the baseline. A record scores the amount it sits **above** that baseline, plus a small bonus if it matched a keyword. Scores are summed across queries, so a record that several symptoms point to rises to the top. Records below a fraction of the best score are dropped.

**Cutoff sweep** (live database; rank of the planted record / number of records passed on; "—" = planted record dropped):

| Cutoff | Mode | P-001 | P-002 | P-003 | P-004 | P-005 (control) |
|---|---|---|---|---|---|---|
| 0.50 | lay | — / 1 | #1 / 2 | #1 / 1 | — / 2 | 1 |
| 0.50 | lay + clinical | #2 / 2 | #1 / 1 | #1 / 1 | #1 / 3 | 1 |
| 0.35 | lay | — / 1 | #1 / 3 | #1 / 1 | — / 3 | 1 |
| 0.35 | lay + clinical | #2 / 2 | #1 / 2 | #1 / 1 | #1 / 4 | 1 |
| **0.25** | lay | **#2 / 2** | #1 / 5 | #1 / 2 | **#5 / 5** | 1 |
| **0.25** | lay + clinical | #2 / 2 | #1 / 3 | #1 / 2 | **#1 / 6** | 1 |

**Decision: 0.25.** It's the only setting that keeps every planted record even when the Brain gives no clinical rewording, which matters for a safety net. With the rewording, lists stay short and the planted record is first or second.

**Caveat:** this was tuned on 5 synthetic patients. It needs re-checking on a larger and more varied set.

---

## 7. Design decisions that came from safety reasoning (not experiments)

**Conflicting records are flagged, never auto-resolved.** An early idea was "the doctor's notes from the last 30 days override older clinic data". For allergies this is dangerous: a quick "no allergies" note could erase a recorded penicillin allergy. Instead:
- Allergies and diagnoses from **both** tiers are always included.
- If one record says "no known allergies" and another records an allergy, a **conflict** is returned: *"Treat the allergy as present until confirmed."*
- Newer information can still rank higher in search, but it can never delete a safety fact.

**AI notes are drafts until the doctor approves them.** If unreviewed AI output went straight into memory, a hallucination could come back at the next visit as "patient history". Drafts aren't searchable, and approval is what embeds a note.

**Tier 1 is read-only, enforced by the database.** The backend's database key has update and delete permission removed on the clinic tables. It can add records (sync) but can't change or remove them. This is checked automatically: attempts fail with `permission denied` (Postgres error 42501).

**Drug safety comes from fixed rules, not the LLM.** A small table maps brand names (including common Indian brands such as Augmentin, Dolo, Brufen, Acitrom) to generics and drug classes, plus interaction rules. For example:
- Augmentin → amoxicillin → penicillin class, so it conflicts with a recorded amoxicillin rash.
- Propranolol is a non-selective beta-blocker, which conflicts with asthma.
- Ibuprofen is an NSAID, which conflicts with warfarin.

The tables are deliberately narrow:
- A penicillin allergy does **not** flag cephalosporins, because cross-reactivity is low and over-flagging trains doctors to ignore warnings.
- **The tables are demo coverage, not a clinical reference.**

---

## 8. Results on the demo patients

Automated check (`python -m rag.check_scenarios`) against the live database: **21 of 21 checks pass.**

| Patient | Planted issue | What the memory layer returns |
|---|---|---|
| P-001 | Asthma; propranolol prescribed | Asthma in safety facts; rule hit (beta-blocker + asthma); the earlier "avoid beta-blockers" note ranked #2 of 3 |
| P-002 | Old clinic record "no known allergies" vs the doctor's recent note about an amoxicillin rash; Augmentin prescribed | Conflict flagged; rule hit (Augmentin → amoxicillin → penicillin) |
| P-003 | On warfarin; ibuprofen suggested | Rule hit (NSAID + anticoagulant); "avoid NSAIDs" note ranked #1 |
| P-004 | Borderline HbA1c, only in a lab note; now thirsty | HbA1c note ranked **#1** (with clinical rewording) / #5 (without) |
| P-005 | Healthy control | No conflicts, no rule hits |

The check also verifies the permission rules end to end:
- A draft note is not searchable until it's approved.
- Clearing the doctor's memory removes their notes but keeps the clinic records.
- The backend's key cannot update or delete clinic records or patients.
- The doctor's "delete" only hides a patient, and Undo restores them.
- Deleting a patient is refused with a doctor's login and works with a receptionist's.

---

## 9. Limitations and open questions

- **Small tuning set.** The scoring and cutoff were tuned on 5 synthetic patients.
- **The clinical rewording has to come from the Brain.** Without it, retrieval of the showcase record drops from #1 to #5 (still included, but only just).
- **Kannada-English is untested end to end.** The memory layer relies on the Brain's first pass producing good English; how well OpenBioLLM translates Kannada-English hasn't been measured.
- **The query prefix is assumed.** MedEmbed-small is used with bge's search prefix ("Represent this sentence for searching relevant passages: "); all tests above used it, but we didn't compare without it.
- **Drug tables are narrow.** They cover the demo scenarios and common cases only.
- **Latency is not measured.** One consult runs one search per symptom, medicine and rewording (typically 4–6 database calls); the full pipeline's timing still needs measuring on the demo machine.

## 10. References
- `BAAI/bge-small-en-v1.5` and `abhinand/MedEmbed-small-v0.1` (Hugging Face), both with 384-dimensional embeddings.
- Postgres full-text search (`tsvector`, `websearch_to_tsquery`, `ts_rank_cd`) and `pgvector` (cosine distance, HNSW index).
- Reciprocal rank fusion (Cormack, Clarke & Büttcher, SIGIR 2009), used inside the database to merge the meaning and keyword rankings of a single query.
- Llama-3-8B context length (8,192 tokens), which OpenBioLLM-8B inherits.
