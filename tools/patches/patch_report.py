"""Patch 2: clinician-readable report renderer + scenario suite that shows every report."""
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
nb = json.loads(path.read_text(encoding="utf-8"))
cells = nb["cells"]

def source(index):
    return "".join(cells[index]["source"])

def put(index, text):
    cells[index]["source"] = text.splitlines(keepends=True)

def replace_in(index, old, new):
    src = source(index)
    if src.count(old) != 1:
        raise SystemExit(f"cell {index}: expected exactly one match, found {src.count(old)}")
    put(index, src.replace(old, new))

RENDERER = r'''def print_lumen_report(result):
    """Readable report rendered only from validated result data; it adds no facts."""
    facts = {fact["id"]: fact for fact in result["documented_facts"]}
    who = {"patient": "Patient", "clinician": "Clinician", "record": "Record",
           "uncertain": "Speaker uncertain"}

    def details(fact):
        return "; ".join(
            f"{key.replace('_', ' ')}: {value}" for key, value in fact["attributes"].items()
            if value != ND and key != "kind"
        )

    def short(fact):
        extra = details(fact)
        return fact["name"] + (f" ({extra})" if extra else "") + f" [{fact['status']}]"

    def names(items, empty=ND):
        return "; ".join(short(fact) for fact in items) or empty

    def show(items, empty, depth=1, evidence=True):
        pad = "  " * depth
        if not items:
            print(pad + empty)
        for fact in items:
            print(f"{pad}- [{fact['id']}] {who[fact['attribution']]}: {short(fact)} | "
                  f"timing: {fact['temporal_scope']} | source: {', '.join(fact['sources'])}")
            if evidence:
                for item in fact["evidence"]:
                    print(f'{pad}    Evidence [{item["unit_id"]}]: "{item["quote"].strip()}"')

    def heading(title):
        print("\n" + title + "\n" + "-" * len(title))

    documented = result["documented_facts"]
    symptoms = result["symptoms"]
    reported = [f for f in symptoms if f["status"] == "reported"]
    denied = [f for f in symptoms if f["status"] == "denied"]
    uncertain = [f for f in symptoms if f["status"] == "uncertain"]
    vital_facts = [v for v in result["vitals"] if "id" in v]
    measured = [v for v in vital_facts if v["status"] in {"measured", "reported"}]
    investigations = result["investigations"]
    urgency = result["urgency_indicators"]
    assessments = [f for f in documented if f["category"] == "assessment"]
    plans = [f for f in documented if f["category"] == "plan"]
    missing, seen_fields = [], set()
    for item in result["missing_information"]:
        if item["field"].casefold() not in seen_fields:
            seen_fields.add(item["field"].casefold())
            missing.append(item)

    print("=" * 72 + "\nLUMEN CLINICAL INTELLIGENCE REPORT\n" + "=" * 72)
    print(result["safety_notice"])

    heading("1. CONSULTATION SUMMARY")
    print("  Presenting symptoms (reported): " + names(reported))
    print("  Explicitly denied symptoms: " + names(denied, "None documented"))
    if uncertain:
        print("  Symptoms with uncertain status: " + names(uncertain))
    print("  Relevant history: " + names(result["health_information"]["items"]))
    print("  Documented vital signs: " + names(measured))
    print("  Documented clinical findings: " + names(result["clinical_findings"]))
    print("  Investigations completed: " + names(investigations["completed"], "None documented"))
    print("  Investigations planned/recommended: "
          + names(investigations["planned_recommended"], "None documented"))
    print("  Documented assessment: "
          + names(assessments, "No diagnosis or clinician assessment documented"))
    print("  Documented plan: " + names(plans, "No plan documented"))
    print("  Urgency / attention indicator: " + urgency["level"])

    heading("2. SYMPTOMS")
    show(symptoms, "No symptoms extracted (this is not proof that none were reported).")

    heading("3. SYMPTOM CHARACTERISTICS")
    if not symptoms:
        print("  " + ND)
    for fact in symptoms:
        print(f"  {fact['name']} [{fact['id']}] - {fact['status']}")
        if fact["status"] == "denied":
            print("    Explicitly denied; characteristics not applicable.")
            continue
        for key in ATTRIBUTES["symptom"]:
            print(f"    {key.replace('_', ' ').capitalize()}: {fact['attributes'][key]}")

    heading("4. VITAL SIGNS")
    for kind in VITAL_KINDS:
        entries = [v for v in vital_facts if v["attributes"]["kind"] == kind]
        if not entries and kind != "other":
            print(f"  {kind.capitalize()}: {ND}")
        for vital in entries:
            attributes = vital["attributes"]
            if vital["status"] in {"measured", "reported"}:
                reading = attributes["value"] + (
                    "" if attributes["unit"] == ND else " " + attributes["unit"])
            else:
                reading = f"{ND} (no measurement; entry is {vital['status']})"
            label = kind.capitalize() if kind != "other" else f"Other ({vital['name']})"
            print(f"  {label}: {reading} | time/context: {attributes['time_context']} | "
                  f"{who[vital['attribution']]}, {vital['temporal_scope']} [{vital['id']}]")
            for item in vital["evidence"]:
                print(f'      Evidence [{item["unit_id"]}]: "{item["quote"].strip()}"')
    print("  'Not documented' means no measurement was recorded; it does not mean normal.")

    heading("5. RELEVANT PATIENT / HEALTH INFORMATION")
    show(result["health_information"]["items"], ND)

    heading("6. CURRENT MEDICATIONS")
    medications = result["medications"]
    current = result["medication_review"]["current_medications"]["items"]
    print("  Current (explicitly documented):")
    show(current, "None documented as current.", 2)
    denials = [m for m in medications if m["status"] == "denied"]
    if denials:
        print("  Explicitly denied:")
        show(denials, "", 2)
    other = [m for m in medications if m not in current and m["status"] != "denied"]
    if other:
        print("  Other medication statements (historical/stopped/planned/considered/uncertain):")
        show(other, "", 2)
    if not medications:
        print("  Not documented: no medication statement or explicit denial.")
    gaps = {}
    for gap in result["medication_review"]["missing_medication_information"]:
        gaps.setdefault(gap["fact_ids"][0], []).append(gap["field"])
    for fact_id, fields in gaps.items():
        print(f"  Not documented for {facts[fact_id]['name']} [{fact_id}]: "
              + ", ".join(fields) + " (verify; do not infer)")

    heading("7. ALLERGIES")
    show(result["allergies"]["items"],
         "Not documented (allergies not mentioned; 'no known allergies' is NOT assumed).")

    heading("8. CLINICAL FINDINGS")
    show(result["clinical_findings"], ND)

    heading("9. POTENTIAL CLINICAL RISKS / SAFETY CONCERNS")
    if not result["potential_risks"]:
        print("  No potential concern identified by the model. This does not establish safety.")
    for concern in result["potential_risks"]:
        print(f"  [{concern['id']}] {concern['category'].replace('_', ' ')} | "
              f"attention: {concern['attention']}")
        print("    DOCUMENTED FACT:")
        show(concern["documented_facts"], "", 3)
        print("    POTENTIAL CONCERN: " + concern["potential_concern"])
        print("    REASON: " + concern["reason"])
        print("    WHAT TO VERIFY:")
        for question in concern["what_to_verify"]:
            print("      - " + question)
        for item in concern["knowledge_context"]:
            print(f"    General medical knowledge, not patient evidence [{item['source_id']}]: "
                  + item["evidence"]["quote"].strip())

    heading("10. RED FLAGS / URGENCY INDICATORS")
    print("  LEVEL: " + urgency["level"])
    if result["red_flags"]:
        print("  Red-flag concerns: " + ", ".join(c["id"] for c in result["red_flags"]))
    for basis in urgency["basis"]:
        print(f"  [{basis['concern_id']}] EVIDENCE: "
              + "; ".join(short(facts[key]) for key in basis["fact_ids"]))
        print("    REASON: " + basis["reason"])
        print("    WHAT TO VERIFY: " + "; ".join(basis["what_to_verify"]))
    if not urgency["basis"]:
        print("  No red flag identified by the model from the documented facts.")
    print("  " + urgency["limitation"])

    heading("11. MISSING INFORMATION")
    if not missing:
        print("  None identified.")
    for item in missing:
        print(f"  - {item['field']}: {ND}. {item['reason']}")

    heading("12. CONTRADICTIONS / INCONSISTENCIES")
    if not result["contradictions"]:
        print("  None identified by the model (this is not proof of consistency).")
    for item in result["contradictions"]:
        print("  CONTRADICTION: " + item["description"])
        show(item["conflicting_facts"], "", 2)
        print("    WHAT TO VERIFY: " + item["what_to_verify"])

    heading("13. TESTS / INVESTIGATIONS")
    print("  COMPLETED:")
    show(investigations["completed"], "None documented.", 2)
    print("  PLANNED / RECOMMENDED (not performed):")
    show(investigations["planned_recommended"], "None documented.", 2)
    if investigations["other_status"]:
        print("  OTHER STATUS (considered/declined/uncertain):")
        show(investigations["other_status"], "", 2)

    heading("14. CLINICAL NOTE (SOAP) - documented statements only")
    note = result["clinical_note"]
    for part, empty in (
        ("SUBJECTIVE", "No subjective statements documented."),
        ("OBJECTIVE", "No measurements, examination findings or completed investigations documented."),
        ("ASSESSMENT", "No diagnosis or clinician assessment documented."),
        ("PLAN", "No plan documented."),
    ):
        print("  " + part)
        show(note[part]["items"], empty, 2, evidence=False)
    for part in ("DOCUMENTED_COMPLETED_ACTIONS", "REPORTED_MEASUREMENTS_OR_FINDINGS",
                 "HISTORICAL_OR_EXTERNAL_RECORDS", "TIMING_REQUIRING_VERIFICATION",
                 "ATTRIBUTION_REQUIRING_VERIFICATION"):
        if note[part]["items"]:
            print("  " + part.replace("_", " "))
            show(note[part]["items"], "", 2, evidence=False)

    heading("15. PEER REVIEW (second-pass documentation safety check)")
    peer = result["peer_review"]
    print("  Relevant history: " + names(peer["relevant_history"]["items"]))
    print("  Key clinical findings: " + names(peer["key_clinical_findings"]["items"]))
    print("  Important symptoms: " + names(peer["important_symptoms"]["items"]))
    print("  Safety concerns: " + ("; ".join(
        f"[{c['id']}] {c['potential_concern']}" for c in peer["safety_concerns"])
        or "None identified by the model (not proof of safety)"))
    print("  Potential high-risk features: " + ("; ".join(
        f"[{c['id']}] {c['attention']}" for c in peer["potential_high_risk_features"])
        or "None identified"))
    print("  Missing information: " + (", ".join(item["field"] for item in missing) or "None identified"))
    print("  Contradictions: " + ("; ".join(c["description"] for c in peer["contradictions"])
                                  or "None identified (not proof of consistency)"))
    print("  Investigations: " + names(peer["investigations"]["items"], "None documented"))
    print("  Documented plan: " + names(peer["documented_plan"]["items"], "No plan documented"))
    print(f"  What should be verified: {len(result['verification_items'])} item(s); see section 16.")
    print("  Urgency / attention indicators: " + peer["urgency_attention_indicators"]["level"])
    print("  Scope: " + peer["scope"])

    heading("16. VERIFICATION ITEMS / QUESTIONS FOR CLINICIAN")
    if not result["verification_items"]:
        print("  None generated.")
    for number, item in enumerate(result["verification_items"], 1):
        refs = ", ".join(item["fact_ids"])
        print(f"  {number}. {item['question']}" + (f" [{refs}]" if refs else ""))

    heading("QUALITY / LIMITATIONS")
    print("  Status: " + result["quality"]["status"])
    for warning in result["quality"]["warnings"]:
        print("  - " + warning)
    print("\n" + "=" * 72 + "\nEND OF LUMEN REPORT\n" + "=" * 72)
'''

cell17 = source(17)
start = cell17.index("def print_lumen_report(result):")
put(17, cell17[:start] + RENDERER)

replace_in(20, '''test_results = []
if RUN_FULL_TEST_SUITE:
    for case in TEST_CASES:
        case_result = (
            respiratory_result if case["name"] == "01 respiratory"
            else analyze_consultation(
                case["transcript"], case.get("patient_history", ""),
                case.get("retrieved_context", ""),
            )
        )
        units, _ = resolve_sources(
            case["transcript"], case.get("patient_history", ""), case.get("retrieved_context", "")
        )
        check_report(case_result, units, case["transcript"])
        verify_scenario(case, case_result)
        test_results.append({"scenario": case["name"], "status": "passed"})
        print("PASS:", case["name"])
        if case["name"] != "01 respiratory":
            del case_result
    print(f"Completed {len(test_results)} synthetic model integration scenarios.")
''', '''import time

test_results = []
if RUN_FULL_TEST_SUITE:
    # Every scenario runs and prints its report next to its transcript, so accuracy
    # can be reviewed against the source. Any failure still stops the notebook below.
    for case in TEST_CASES:
        started = time.time()
        print("\\n" + "#" * 72 + f"\\nSCENARIO {case['name']}\\n" + "#" * 72)
        print("TRANSCRIPT (source evidence):\\n" + case["transcript"])
        if case.get("patient_history"):
            print("PATIENT HISTORY (source evidence):", case["patient_history"])
        try:
            case_result = (
                respiratory_result if case["name"] == "01 respiratory"
                else analyze_consultation(
                    case["transcript"], case.get("patient_history", ""),
                    case.get("retrieved_context", ""),
                )
            )
            units, _ = resolve_sources(
                case["transcript"], case.get("patient_history", ""), case.get("retrieved_context", "")
            )
            check_report(case_result, units, case["transcript"])
            print_lumen_report(case_result)
            verify_scenario(case, case_result)
            status, detail = "passed", ""
        except (StructuredOutputError, InputBudgetError, AssertionError) as exc:
            status, detail = "FAILED", f"{type(exc).__name__}: {exc}"
        case_result = None
        seconds = round(time.time() - started)
        test_results.append({"scenario": case["name"], "status": status,
                             "detail": detail, "seconds": seconds})
        print(f"{status.upper()}: {case['name']} ({seconds} s) {detail}")
    print("\\nSCENARIO SUMMARY")
    for row in test_results:
        print(f"  {row['status']:<7}{row['scenario']:<26}{row['seconds']:>6} s  {row['detail']}")
    failed = [row for row in test_results if row["status"] != "passed"]
    if failed:
        raise AssertionError(
            f"{len(failed)} of {len(test_results)} scenarios failed: "
            + "; ".join(f"{row['scenario']}: {row['detail']}" for row in failed)
        )
    print(f"Completed {len(test_results)} synthetic model integration scenarios.")
''')

replace_in(19, '''respiratory_result = analyze_consultation(
    transcript, patient_history=patient_history, retrieved_context=retrieved_context
)
''', '''import time
started = time.time()
respiratory_result = analyze_consultation(
    transcript, patient_history=patient_history, retrieved_context=retrieved_context
)
print(f"Analysis time: {time.time() - started:.0f} s")
''')

path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print("Patched cells 17, 19, 20 in", path.name)
