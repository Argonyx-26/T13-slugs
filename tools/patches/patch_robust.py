"""Patch 3: robustness + accuracy fixes found while running on Kaggle.

- cell 3: release a failed cell's traceback so CUDA memory can be freed on re-run.
- cell 5: bounded page limits (8) so a looping model cannot burn 16 slow pages.
- cell 13: literal-only evidence citation repair, clearer extraction guidance,
           merging of repeated facts, graceful pagination stop.
- cell 15: analysis items de-duplicated by meaning; graceful pagination stop.
- cell 17: analyze_consultation surfaces repairs/limits as quality warnings.
- cell 20: tests accept equivalent literal forms; reports saved to a text file.
- markdown cells document the changes.
"""
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
        raise SystemExit(f"cell {index}: expected exactly one match, found {src.count(old)}:\n{old[:120]}")
    put(index, src.replace(old, new))

# ---------------------------------------------------------------- cell 0 (markdown)
replace_in(0, "## Kaggle setup\n", """## Changes after the first Kaggle test run
- An attribute value missing from its cited evidence becomes `Not documented` and
  is listed as a quality warning, instead of aborting the whole consultation.
- An inexact evidence quote is repaired only by citing literal source text (the unit
  that contains it, or the full line when only punctuation differs); fact names and
  attribute values must still appear verbatim in that text.
- Repeated extractions of the same fact are merged; repeated analysis items are
  collapsed; a model that keeps paging repeats is stopped instead of failing.
- `print_lumen_report` renders a clinician-readable report from the validated facts;
  the test suite prints every scenario report next to its transcript.

## Kaggle setup
""")

# ---------------------------------------------------------------- cell 3
replace_in(3, """if "model" in globals():
    del model
""", """# A failed cell's traceback can keep CUDA tensors alive; release it first.
for name in ("last_type", "last_value", "last_traceback", "last_exc"):
    if hasattr(sys, name):
        setattr(sys, name, None)
if "model" in globals():
    del model
""")

# ---------------------------------------------------------------- cell 5
replace_in(5, "MAX_EXTRACTION_PAGES = 16\nMAX_ANALYSIS_PAGES = 16\n",
           "MAX_EXTRACTION_PAGES = 8\nMAX_ANALYSIS_PAGES = 8\n")

# ---------------------------------------------------------------- cell 12 (markdown)
replace_in(12, "Canonical vital names live in a separate `kind` attribute.\n", """Canonical vital names live in a separate `kind` attribute.
An inexact quote is re-cited only to literal source text; each repair is reported.
Repeated extractions of the same statement are merged into one fact.
""")

# ---------------------------------------------------------------- cell 13
replace_in(13, "name: a short exact substring of cited evidence; no speaker prefixes.\n",
           "name: a short exact substring of cited evidence; no speaker prefixes.\n"
           "Use the shortest literal clinical phrase, e.g. 'cough' or 'chest pain'.\n")
replace_in(13, "Exception: vital.kind uses a canonical vital_kinds value.\n",
           "Exception: vital.kind uses a canonical vital_kinds value.\n"
           "For a vital, value is only the number as written (e.g. 39.2, 82/48) and\n"
           "unit is only the unit as written (e.g. C, mmHg, %, /min).\n")
replace_in(13, "Use investigation completed only if performance/results are documented.\n",
           "Use investigation completed only if performance/results are documented.\n"
           "Tests (e.g. X-ray, ECG, blood tests, scans) use category investigation,\n"
           "never plan; an ordered or scheduled test has status planned.\n")

replace_in(13, '''def ground_value(value, quotes):''', '''def loosely_contains(text, quote):
    """True when quote matches text apart from case, punctuation and spacing."""
    def normalize(value):
        return " ".join(re.sub(r"[^0-9a-z]+", " ", value.casefold()).split())
    needle = normalize(quote)
    return len(needle) >= 8 and f" {needle} " in f" {normalize(text)} "

def ground_value(value, quotes):''')

replace_in(13, '''        quotes = []
        for evidence in fact["evidence"]:
            require_keys(evidence, {"unit_id", "quote"}, "evidence")
            require_text(evidence["unit_id"], "unit_id")
            require_text(evidence["quote"], "quote")
            unit = lookup.get(evidence["unit_id"])
            if unit is None:
                raise StructuredOutputError("Evidence refers to an unknown source unit.")
            grounded_quote = source_span(evidence["quote"], unit.text)
            if grounded_quote is None:
                raise StructuredOutputError(
                    f"Evidence quote {evidence['quote']!r} is not present in "
                    f"source unit {unit.unit_id}. Copy its literal wording."
                )
            evidence["quote"] = grounded_quote
''', '''        quotes = []
        repairs = []
        for evidence in fact["evidence"]:
            require_keys(evidence, {"unit_id", "quote"}, "evidence")
            require_text(evidence["unit_id"], "unit_id")
            require_text(evidence["quote"], "quote")
            unit = lookup.get(evidence["unit_id"])
            if unit is None:
                raise StructuredOutputError("Evidence refers to an unknown source unit.")
            grounded_quote = source_span(evidence["quote"], unit.text)
            if grounded_quote is None:
                # Repair only by citing literal source text: the one unit that
                # contains the quote verbatim, or the cited line when the quote
                # differs only in punctuation. The fact name and attributes must
                # still be found verbatim in that text below.
                owners = [candidate for candidate in units
                          if source_span(evidence["quote"], candidate.text) is not None]
                if len(owners) == 1:
                    unit = owners[0]
                    evidence["unit_id"] = unit.unit_id
                    grounded_quote = source_span(evidence["quote"], unit.text)
                    repairs.append({"unit_id": unit.unit_id,
                                    "action": "quote found in a different source line; citation corrected"})
                elif loosely_contains(unit.text, evidence["quote"]):
                    grounded_quote = unit.text.strip()
                    repairs.append({"unit_id": unit.unit_id,
                                    "action": "quote differed only in punctuation; full source line cited"})
                else:
                    raise StructuredOutputError(
                        f"Evidence quote {evidence['quote']!r} is not present in "
                        f"source unit {unit.unit_id}. Copy its literal wording."
                    )
            evidence["quote"] = grounded_quote
''')

replace_in(13, '''        if removed:
            fact["ungrounded_attributes_removed"] = removed
''', '''        if removed:
            fact["ungrounded_attributes_removed"] = removed
        if repairs:
            fact["evidence_repairs"] = repairs
''')

cell13 = source(13)
start = cell13.index("def fact_identity(fact):")
put(13, cell13[:start] + '''def fact_key(fact):
    """Clinical identity used to merge repeated extractions of one statement."""
    attributes = fact["attributes"]
    return json.dumps([
        fact["category"], " ".join(fact["name"].casefold().split()), fact["status"],
        fact["temporal_scope"], fact["attribution"],
        attributes.get("kind", ""), attributes.get("value", ""),
    ], ensure_ascii=False)

def merge_fact(target, fact):
    """Merge a repeated fact. Evidence is merged with the attributes it supports,
    so every attribute stays grounded; check_report re-validates each fact."""
    for item in fact["evidence"]:
        if item not in target["evidence"]:
            target["evidence"].append(item)
    for key, value in fact["attributes"].items():
        if value != ND and target["attributes"].get(key, ND) == ND:
            target["attributes"][key] = value
    for key in ("ungrounded_attributes_removed", "evidence_repairs"):
        extra = [item for item in fact.get(key, []) if item not in target.get(key, [])]
        if extra:
            target[key] = target.get(key, []) + extra

def extract_facts(units):
    collected = {}
    notes = []
    for source in ("transcript", "patient_history", "explicit_context"):
        for window in unit_windows([u for u in units if u.source == source]):
            for domain in DOMAINS:
                seen = []
                for page_number in range(MAX_EXTRACTION_PAGES):
                    payload = {
                        "stage": "FACT_EXTRACTION",
                        "allowed_categories": domain,
                        "allowed_statuses": {key: sorted(STATUSES[key]) for key in domain},
                        "allowed_attributes": {key: ATTRIBUTES[key] for key in domain},
                        "vital_kinds": VITAL_KINDS,
                        "source_units": [unit.__dict__ for unit in window],
                        "already_extracted": [
                            {"category": f["category"], "name": f["name"],
                             "status": f["status"], "temporal_scope": f["temporal_scope"],
                             "attributes": {k: v for k, v in f["attributes"].items() if v != ND}}
                            for f in (collected[key] for key in seen)
                        ],
                    }
                    response = generate_json(
                        EXTRACTION_SYSTEM, payload,
                        lambda data: validate_fact_page(data, domain, window),
                        EXTRACTION_NEW_TOKENS,
                    )
                    added = 0
                    for fact in response["facts"]:
                        fact["attributes"] = {
                            key: fact["attributes"].get(key, ND) for key in ATTRIBUTES[fact["category"]]
                        }
                        key = fact_key(fact)
                        if key in collected:
                            merge_fact(collected[key], fact)
                        else:
                            collected[key] = fact
                        if key not in seen:
                            seen.append(key)
                            added += 1
                    # Repeats are not progress: stop even if the model claims more.
                    if not response["has_more"] or not added:
                        break
                else:
                    notes.append(
                        f"Fact extraction ({'/'.join(domain)}, {source}) stopped at the "
                        f"{MAX_EXTRACTION_PAGES}-page limit; some facts may be missing."
                    )
    result = []
    for index, fact in enumerate(collected.values(), 1):
        fact = copy.deepcopy(fact)
        fact["id"] = f"F{index:04d}"
        fact["sources"] = sorted({item["unit_id"].split(":")[0] for item in fact["evidence"]})
        fact["attribution_note"] = (
            "Speaker attribution uncertain." if fact["attribution"] == "uncertain"
            else "Historical source; verify current applicability."
            if "patient_history" in fact["sources"] else "Source-linked; clinician verification required."
        )
        result.append(fact)
    return result, notes
''')

# ---------------------------------------------------------------- cell 14 (markdown)
replace_in(14, """If a prompt or pagination limit is exceeded, the run fails explicitly.
""", """If a prompt limit is exceeded, the run fails explicitly. Restated items are
collapsed; if the page limit is reached, the report keeps validated items and
states the limitation as a quality warning.
""")

# ---------------------------------------------------------------- cell 15
cell15 = source(15)
start = cell15.index("def analyze_facts(facts, knowledge_units):")
end = cell15.index("MISSING_SYSTEM = BASE_SYSTEM")
put(15, cell15[:start] + '''ANALYSIS_KEYS = {
    "concerns": lambda item: json.dumps([item["category"], sorted(item["fact_ids"])]),
    "missing_information": lambda item: " ".join(item["field"].casefold().split()),
    "contradictions": lambda item: json.dumps(sorted(item["fact_ids"])),
    "verification_items": lambda item: " ".join(item["question"].casefold().split()),
}

def unique_analysis(key, items):
    """Collapse restated items; for a repeated concern keep the higher attention."""
    unique = {}
    for item in items:
        identity = ANALYSIS_KEYS[key](item)
        current = unique.get(identity)
        if current is None or (
            key == "concerns"
            and ATTENTION.index(item["attention"]) > ATTENTION.index(current["attention"])
        ):
            unique[identity] = item
    return list(unique.values())

def analyze_facts(facts, knowledge_units):
    aggregate = {key: [] for key in ANALYSIS_KEYS}
    notes = []
    batches = analysis_batches(facts)
    knowledge_windows = unit_windows(knowledge_units) or [[]]
    # A medication and its allergy/bleeding evidence can land in different batches.
    combined_batches = batches + [
        left + right for left, right in itertools.combinations(batches, 2)
    ]
    jobs = [("safety", batch, window) for batch in combined_batches for window in knowledge_windows]
    # Check within each batch and across every distinct batch pair.
    jobs.extend(("consistency", batch, []) for batch in batches if len(batch) > 1)
    jobs.extend(
        ("consistency", left + right, []) for left, right in itertools.combinations(batches, 2)
    )
    for task, batch, knowledge in jobs:
        previous = {key: [] for key in ANALYSIS_KEYS}
        for page in range(MAX_ANALYSIS_PAGES):
            payload = {
                "stage": "CLINICAL_ANALYSIS",
                "task": task,
                "patient_facts": [compact_fact(fact) for fact in batch],
                "medical_knowledge": [unit.__dict__ for unit in knowledge],
                "concern_categories": sorted(CONCERN_CATEGORIES),
                "attention_levels": ATTENTION,
                "already_returned": previous,
                "scope": (
                    "This is one fact batch. Propose missing items, but a final "
                    "global pass will verify absence against ALL facts."
                ),
            }
            response = generate_json(
                ANALYSIS_SYSTEM, payload,
                lambda data: validate_analysis_page(data, batch, knowledge, task),
                ANALYSIS_NEW_TOKENS,
            )
            added = 0
            for key in ANALYSIS_KEYS:
                merged = unique_analysis(key, previous[key] + response[key])
                added += len(merged) - len(previous[key])
                previous[key] = merged
            # Restated items are not progress: stop instead of paging repeats.
            if not response["has_more"] or not added:
                break
        else:
            notes.append(
                f"{task.capitalize()} analysis stopped at the {MAX_ANALYSIS_PAGES}-page "
                "limit; further items may exist. Clinician review is required."
            )
        for key in ANALYSIS_KEYS:
            aggregate[key].extend(previous[key])
    aggregate = {key: unique_analysis(key, value) for key, value in aggregate.items()}
    aggregate["missing_information"] = confirm_missing_globally(
        aggregate["missing_information"], batches
    )
    aggregate["notes"] = list(dict.fromkeys(notes))
    return aggregate

''' + cell15[end:])

# ---------------------------------------------------------------- cell 17
replace_in(17, '''    facts = extract_facts(source_units)
    analysis = analyze_facts(facts, knowledge_units)
    result = build_report(facts, analysis, knowledge_units)
    for fact in facts:
        for item in fact.get("ungrounded_attributes_removed", []):
            result["quality"]["warnings"].append(
                f"{fact['id']} {fact['name']!r}: model value {item['rejected_model_value']!r} "
                f"for {item['attribute']} is not in the cited evidence and was replaced "
                "with Not documented. Verify this detail against the source."
            )
    check_report(result, source_units, transcript)
''', '''    facts, extraction_notes = extract_facts(source_units)
    analysis = analyze_facts(facts, knowledge_units)
    result = build_report(facts, analysis, knowledge_units)
    warnings = result["quality"]["warnings"]
    for fact in facts:
        for item in fact.get("ungrounded_attributes_removed", []):
            warnings.append(
                f"{fact['id']} {fact['name']!r}: model value {item['rejected_model_value']!r} "
                f"for {item['attribute']} is not in the cited evidence and was replaced "
                "with Not documented. Verify this detail against the source."
            )
        for item in fact.get("evidence_repairs", []):
            warnings.append(
                f"{fact['id']} {fact['name']!r}: evidence citation repaired "
                f"({item['action']}; {item['unit_id']})."
            )
    warnings.extend(extraction_notes + analysis["notes"])
    check_report(result, source_units, transcript)
''')

# ---------------------------------------------------------------- cell 18 (markdown)
replace_in(18, "surfaced with the scenario name, not suppressed or replaced with expected data.",
           "surfaced with the scenario name, not suppressed or replaced with expected data.\n"
           "Every scenario runs; each report is printed after its transcript and saved to\n"
           "`lumen_scenario_reports.txt`, and the cell raises at the end if any failed.")

# ---------------------------------------------------------------- cell 20
replace_in(20, '''        "characteristics": {"chest pain": {"onset": "yesterday", "radiation": "left arm",''',
           '''        "characteristics": {"chest pain": {"onset|duration": "yesterday", "radiation": "left arm",''')
replace_in(20, '''    for symptom, attributes in case.get("characteristics", {}).items():
        for key, value in attributes.items():
            demand(any(value.casefold() in f["attributes"][key].casefold()
                       for f in matching("symptom", symptom)),
                   f"missing {symptom} characteristic {key}")
    for kind, expected in case.get("vitals", {}).items():
        demand(any(
            f["category"] == "vital" and f["attributes"]["kind"] == kind
            and f["attributes"]["value"] == expected and f["status"] in {"reported", "measured"}
            for f in facts
        ), f"missing/wrong vital {kind}={expected}")
''', '''    for symptom, attributes in case.get("characteristics", {}).items():
        for keys, value in attributes.items():
            # "onset|duration": "since yesterday" may be recorded as either.
            demand(any(value.casefold() in f["attributes"][key].casefold()
                       for f in matching("symptom", symptom) for key in keys.split("|")),
                   f"missing {symptom} characteristic {keys}")
    for kind, expected in case.get("vitals", {}).items():
        # The literal number must appear as a whole number (39.2 matches "39.2 C").
        number = re.compile(rf"(?<![\\d.]){re.escape(expected)}(?![\\d.])")
        demand(any(
            f["category"] == "vital" and f["attributes"]["kind"] == kind
            and number.search(f["attributes"]["value"]) and f["status"] in {"reported", "measured"}
            for f in facts
        ), f"missing/wrong vital {kind}={expected}")
''')

replace_in(20, '''import time

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
    failed''', '''import contextlib
import io
import time

REPORT_PATH = os.path.join(
    "/kaggle/working" if os.path.isdir("/kaggle/working") else ".", "lumen_scenario_reports.txt"
)
test_results = []
if RUN_FULL_TEST_SUITE:
    # Every scenario runs and prints its report next to its transcript, so accuracy
    # can be reviewed against the source. Any failure still stops the notebook below.
    with open(REPORT_PATH, "w", encoding="utf-8") as report_file:
        def emit(text):
            print(text)
            report_file.write(text + "\\n")
            report_file.flush()
        emit("LUMEN synthetic scenario reports. Synthetic test data; clinician review required.")
        for case in TEST_CASES:
            started = time.time()
            emit("\\n" + "#" * 72 + f"\\nSCENARIO {case['name']}\\n" + "#" * 72)
            emit("TRANSCRIPT (source evidence):\\n" + case["transcript"])
            if case.get("patient_history"):
                emit("PATIENT HISTORY (source evidence): " + json.dumps(case["patient_history"]))
            try:
                case_result = (
                    respiratory_result if case["name"] == "01 respiratory"
                    else analyze_consultation(
                        case["transcript"], case.get("patient_history", ""),
                        case.get("retrieved_context", ""),
                    )
                )
                units, _ = resolve_sources(
                    case["transcript"], case.get("patient_history", ""),
                    case.get("retrieved_context", ""),
                )
                check_report(case_result, units, case["transcript"])
                buffer = io.StringIO()
                with contextlib.redirect_stdout(buffer):
                    print_lumen_report(case_result)
                emit(buffer.getvalue())
                verify_scenario(case, case_result)
                status, detail = "passed", ""
            except (StructuredOutputError, InputBudgetError, AssertionError) as exc:
                status, detail = "FAILED", f"{type(exc).__name__}: {exc}"
            case_result = None
            seconds = round(time.time() - started)
            test_results.append({"scenario": case["name"], "status": status,
                                 "detail": detail, "seconds": seconds})
            emit(f"{status.upper()}: {case['name']} ({seconds} s) {detail}")
        emit("\\nSCENARIO SUMMARY")
        for row in test_results:
            emit(f"  {row['status']:<7}{row['scenario']:<26}{row['seconds']:>6} s  {row['detail']}")
    print("Scenario reports saved to", REPORT_PATH)
    failed''')

path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print("Patched cells 0, 3, 5, 12, 13, 14, 15, 17, 18, 20 in", path.name)
