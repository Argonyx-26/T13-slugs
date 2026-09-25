# Early Health-Risk Detection and Decision Support

> **Problem statement 4:** Develop an intelligent solution that analyzes available patient symptoms, vital signs,
> and relevant health information to identify potential high-risk conditions and provide real-time decision
> support for timely medical attention and intervention.

## How each part of the problem is met

| The problem asks us to… | What does it | Where |
|---|---|---|
| analyze **vital signs** | Taken at check-in: BP, pulse, breathing rate, temperature (°C or °F), SpO₂, oxygen, consciousness, blood sugar, weight. Scored with **NEWS2** | `vital_signs` table, `risk.news2()` |
| analyze **symptoms** | The desk's complaint at check-in, then the symptoms the Brain extracts from the consult recording (any language → English) | `reception.record_vitals()`, Brain pass 1 |
| analyze **relevant health information** | The patient's allergies, conditions and medicines (always), past records related to today's symptoms (search), and earlier vital signs (trends) | `get_context()`, `risk._trends()` |
| **identify high-risk conditions** | Fixed, explainable rules: NEWS2, sepsis, heart attack, stroke, DKA, low sugar, hypertensive emergency, GI bleed on a blood thinner, anaphylaxis, self-harm, pregnancy warnings, and early risks (diabetes, hypertension, weight loss, TB) | `rag/risk.py`, `rag/data/red_flags.json` |
| **real-time** decision support | Assessed the moment vitals are saved (the rules themselves take milliseconds; the history lookup takes a second or two), and again as soon as the consult's symptoms are extracted | `record_vitals()`, `assess_patient()` |
| **timely medical attention** | The day's queue is ordered by risk. A critical patient goes to the top, ahead of patients who arrived earlier | `triage_queue()` |
| decision support for **intervention** | Every finding gives an urgency level, the reasons, what to check or do next, and the records it's based on. The doctor decides | `RiskFinding.action`, `.evidence` |

## Two moments, same rules

```
CHECK-IN (triage)                                   CONSULT
Desk enters vitals + main complaint                  Recording → transcript → Brain pass 1: symptoms
        │                                                   │
        ▼                                                   ▼
risk.assess_patient(stage="triage")              risk.assess_patient(stage="consult")
  NEWS2 + thresholds + red flags + history          same rules, fuller symptoms
        │                                                   │
        ▼                                                   ▼
Queue re-orders: critical → high → medium →      Risk block shown to the doctor and passed to
then token order                                  Brain pass 2, which explains it but can't lower it
```

## Risk levels

| Level | What happens | Examples |
|---|---|---|
| **Critical** | Emergency: the doctor sees the patient now; be ready to transfer | NEWS2 ≥ 7, possible sepsis, chest pain with sweating, stroke signs, blood sugar < 54, black stools on warfarin |
| **High** | Urgent: front of the queue | NEWS2 5–6, chest pain alone, BP ≥ 180/120, blood sugar < 70 or ≥ 300, infection plus one sepsis sign |
| **Medium** | Priority: see soon, recheck vitals every 30 min | One vital sign in the danger range (+3), early risks: rising BP, diabetes signs, weight loss |
| **Low** | Routine queue order | Normal vitals, no red flags |

## The five rule engines

1. **NEWS2** (Royal College of Physicians, 2017) is the UK standard early-warning score used in hospitals. It
   uses seven vital signs. Missing signs are listed as gaps, never assumed normal.
2. **Thresholds NEWS2 doesn't cover**, such as very high BP, low or high blood sugar, and possible DKA
   (high sugar + vomiting/abdominal pain/drowsiness in a diabetic).
3. **Red-flag symptoms** (`red_flags.json`, readable by a clinician without reading code). The patient's history can
   raise the level: *black stools* is high, but *black stools on warfarin* is critical, and the finding cites the
   warfarin prescription. "No chest pain" doesn't fire the chest-pain rule.
4. **Sepsis**: infection signs (fever, chills, pus, measured temperature) plus qSOFA-style warning signs
   (breathing ≥ 22, systolic BP ≤ 100, new confusion). Two signs are critical; one is high.
5. **Trends across visits** (*early* detection): BP rising over three visits, BP raised on two days with no
   hypertension diagnosis, ≥ 5 % weight loss within a year, repeated blood sugar ≥ 200 with no diabetes on record.

## Why rules, not the LLM, set the level

- **Explainable.** Every finding lists its reasons and the records it used (`H<id>`).
- **Consistent.** The same inputs always give the same level, and nothing can talk the model out of a sepsis flag.
- **Safe with missing data.** Unmeasured vitals are reported as gaps, and an allergy never recorded is "unknown", not "none".
- The LLM adds language and context around the level, but it can never set or lower it.

## Demo patients

| Patient | Story | Risk |
|---|---|---|
| **P-006** | Diabetic with an infected heel ulcer; fever, chills, new confusion. RR 24, BP 94/58, pulse 118, 38.9 °C | **Critical**: NEWS2 11 and possible sepsis. Arrives second, goes to the top of the queue |
| **P-004** | Thirsty, urinating at night. Borderline HbA1c 6 months ago, BP 128 → 136 → 148, weight 74 → 69.5 kg, glucose 232 | **Medium**: early diabetes and hypertension risk, weight loss, each citing the records |
| P-003 | On warfarin; back pain, doctor suggests ibuprofen | Low risk; the **drug check** flags NSAID + warfarin |
| P-001, P-002, P-005 | Drug-safety cases and a simple cold | Low |

Run `python -m rag.check_scenarios --show P-006` to see the full risk block.

## Limits (say these before a judge asks)

- The rules cover common, well-established red flags for a hackathon demo. They are not a validated clinical tool.
- NEWS2 is validated for adults. Children and pregnancy need their own scores (PEWS, MEOWS), which aren't built.
- Symptom matching uses words, not meaning. It depends on Brain pass 1 giving clear English symptoms.
