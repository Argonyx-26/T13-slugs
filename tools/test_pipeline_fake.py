"""Run the notebook's real pipeline code with a scripted fake LLM (no GPU needed).

Exercises: extraction pagination (incl. repeated has_more), fact merging, both
evidence-citation repairs, ungrounded-attribute removal, malformed-JSON retry,
analysis de-duplication (higher attention wins), global missing-info check,
build_report/check_report, the readable renderer and the scenario-suite cell.
"""
import json
import os
import re
import sys

nb = json.load(open(sys.argv[1], encoding="utf-8"))
os.chdir(sys.argv[2])
cells = ["".join(c["source"]) for c in nb["cells"]]


class FakeTokenizer:
    is_fast = True
    eos_token_id = 1
    pad_token_id = 1
    model_max_length = 8192

    def __call__(self, text, add_special_tokens=False, return_offsets_mapping=False):
        offsets = [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]
        return {"input_ids": list(range(len(offsets))), "offset_mapping": offsets}

    def encode(self, text, add_special_tokens=False):
        return re.findall(r"\S+", text)

    def apply_chat_template(self, messages, tokenize=True, add_generation_prompt=True, **_):
        text = " ".join(m["content"] for m in messages)
        return re.findall(r"\S+", text) if tokenize else text


ns = {"tokenizer": FakeTokenizer(), "PROMPT_LIMIT": 6144, "CONTEXT_LIMIT": 8192,
      "os": os, "sys": sys}
for index in (5, 11, 13, 15, 17):
    exec(cells[index], ns)

calls = {"extraction": 0, "analysis": 0, "missing": 0, "invalid_json_served": 0}


def ev(unit, quote):
    return [{"unit_id": unit, "quote": quote}]


def fact(category, name, status, attribution, evidence, temporal="current", **attributes):
    return {"category": category, "name": name, "status": status, "temporal_scope": temporal,
            "attribution": attribution, "attributes": attributes, "evidence": evidence}


cough = fact("symptom", "cough", "reported", "patient",
             ev("transcript:1", "I have a mild cough, and feel very tired for three days"),
             severity="mild", duration="three days", onset="three days ago")
EXTRACTION = {
    ("PATIENT: I have a mild cough", "symptom"): {
        0: {"facts": [
            cough,
            fact("symptom", "tired", "reported", "patient",
                 ev("transcript:2", "feel very tired for three days"),  # wrong unit on purpose
                 severity="very", duration="three days"),
            fact("symptom", "chest pain", "denied", "patient",
                 ev("transcript:2", "I do not have chest pain or difficulty breathing")),
            fact("symptom", "difficulty breathing", "denied", "patient",
                 ev("transcript:2", "I do not have chest pain or difficulty breathing")),
        ], "has_more": True},
        4: {"facts": [
            fact("vital", "temperature", "planned", "clinician",
                 ev("transcript:3", "We will check your temperature"), temporal="future",
                 kind="temperature"),
            cough,  # repeat of an extracted fact: must merge, not duplicate
        ], "has_more": True},
        5: {"facts": [cough], "has_more": True},  # only repeats: must stop, not loop/raise
    },
    ("PATIENT: I have a mild cough", "medication"): {0: {"facts": [
        fact("medication", "medications", "denied", "patient",
             ev("transcript:4", "I am not taking any medications.")),
        fact("allergy", "no known allergies", "denied", "patient",
             ev("transcript:4", "I have no known allergies.")),
    ], "has_more": False}},
    ("PATIENT: I have a mild cough", "investigation"): {0: {"facts": [
        fact("plan", "check your temperature and other vital signs", "planned", "clinician",
             ev("transcript:3", "We will check your temperature and other vital signs."),
             temporal="future"),
    ], "has_more": False}},
    ("PATIENT: I have no fever", "symptom"): {0: {"facts": [
        fact("symptom", "fever", "denied", "patient",
             ev("transcript:1", "I have no fever at all during this illness.")),
        fact("symptom", "fever", "reported", "patient",
             ev("transcript:2", "I have had fever every day for the last three days"),
             frequency="every day", duration="the last three days"),
    ], "has_more": False}},
    ("PATIENT: I have fatigue", "symptom"): {0: {"facts": [
        fact("symptom", "fatigue", "reported", "patient",
             ev("transcript:1", "I have fatigue for one week."), duration="one week"),
    ], "has_more": False}},
    ("PATIENT: I have fatigue", "medication"): {0: {"facts": [
        fact("medication", "metformin", "current", "patient",
             ev("transcript:1", "I currently take metformin 500 mg twice daily."),
             dose="500 mg", frequency="twice daily"),
    ], "has_more": False}},
    ("{", "history"): {0: {"facts": [
        fact("history", "type 2 diabetes", "documented", "record",
             ev("patient_history:2", '"diagnosis": "type 2 diabetes"')
             + ev("patient_history:3", '"record_date": "2023-06-01"'),
             temporal="historical", time_context="2023-06-01"),
    ], "has_more": False}},
}
EMPTY_FACTS = {"facts": [], "has_more": False}
EMPTY_ANALYSIS = {"concerns": [], "missing_information": [], "contradictions": [],
                  "verification_items": [], "has_more": False}


def fake_safe_generate(messages, max_new_tokens):
    payload = json.loads(messages[1]["content"])
    repair = "original_input" in payload
    if repair:
        payload = payload["original_input"]
    if "candidate" in payload:
        calls["missing"] += 1
        return json.dumps({"documented_fact_ids": []})
    if payload["stage"] == "FACT_EXTRACTION":
        calls["extraction"] += 1
        key = (payload["source_units"][0]["text"][:28].rstrip(), payload["allowed_categories"][0])
        key = next((k for k in EXTRACTION if key[0].startswith(k[0]) and k[1] == key[1]), None)
        if key == ("PATIENT: I have a mild cough", "investigation") and not repair:
            calls["invalid_json_served"] += 1
            return "Sure! Here is the JSON you asked for."
        pages = EXTRACTION.get(key, {})
        return json.dumps(pages.get(len(payload["already_extracted"]), EMPTY_FACTS))
    calls["analysis"] += 1
    ids = {f["name"]: f["id"] for f in payload["patient_facts"]}
    if payload["task"] == "consistency":
        fever = [f["id"] for f in payload["patient_facts"] if f["name"] == "fever"]
        if len(fever) == 2:
            return json.dumps({**EMPTY_ANALYSIS, "contradictions": [{
                "fact_ids": fever,
                "description": "Fever is both denied and reported for the same illness.",
                "what_to_verify": "Clarify whether fever occurred during this illness.",
            }]})
        return json.dumps(EMPTY_ANALYSIS)
    if "cough" in ids:
        concern = {
            "category": "missing_critical_information", "fact_ids": [ids["cough"], ids["tired"]],
            "knowledge_ids": [],
            "potential_concern": "Respiratory symptom with fatigue and no documented vital signs.",
            "reason": "Severity cannot be judged until vital signs are measured.",
            "what_to_verify": ["Record temperature, oxygen saturation and respiratory rate."],
            "attention": "Routine clinician review",
        }
        if not payload["already_returned"]["concerns"]:
            return json.dumps({**EMPTY_ANALYSIS, "has_more": True, "concerns": [concern],
                               "missing_information": [{"field": "Oxygen saturation",
                                                        "reason": "Relevant to a cough.",
                                                        "fact_ids": [ids["cough"]]}],
                               "verification_items": [{"question": "Is the cough productive?",
                                                       "fact_ids": [ids["cough"]]}]})
        restated = dict(concern, attention="Prompt clinician review",
                        potential_concern="Cough and tiredness without any recorded vital signs.")
        return json.dumps({**EMPTY_ANALYSIS, "has_more": True, "concerns": [restated]})
    return json.dumps(EMPTY_ANALYSIS)


ns["safe_generate"] = fake_safe_generate

# Cell 19: the respiratory example through the real analyze_consultation.
exec(cells[19], ns)
result = ns["respiratory_result"]
facts = {f["name"]: f for f in result["documented_facts"]}
assert sorted(facts) == sorted([
    "cough", "tired", "chest pain", "difficulty breathing", "temperature", "medications",
    "no known allergies", "check your temperature and other vital signs"]), sorted(facts)
assert len(result["documented_facts"]) == 8, "repeated cough must be merged, not duplicated"
assert facts["cough"]["attributes"]["onset"] == "Not documented"
assert facts["cough"]["evidence"][0]["quote"].startswith("PATIENT: I have a mild cough and")
assert facts["tired"]["evidence"][0]["unit_id"] == "transcript:1", "citation not corrected"
assert result["potential_risks"][0]["attention"] == "Prompt clinician review", "higher attention lost"
assert len(result["potential_risks"]) == 1, "restated concern must collapse"
assert calls["invalid_json_served"] == 1
warnings = "\n".join(result["quality"]["warnings"])
assert "three days ago" in warnings and "citation corrected" in warnings and "punctuation" in warnings
print("respiratory pipeline assertions passed; calls:", calls)

# Cell 20: the real suite. Scripted scenarios 01, 07 and 10 should pass; the other
# twelve have no scripted model output, so they must be reported as FAILED and the
# cell must raise at the end rather than hide them.
import contextlib
with open("suite_stdout.txt", "w", encoding="utf-8") as sink, contextlib.redirect_stdout(sink):
    try:
        exec(cells[20], ns)
        raised = None
    except AssertionError as exc:
        raised = exc
rows = {row["scenario"]: row for row in ns["test_results"]}
for row in ns["test_results"]:
    print(f"  {row['status']:<7}{row['scenario']:<26}{row['detail'][:90]}")
assert raised is not None and "12 of 15 scenarios failed" in str(raised), raised
for name in ("01 respiratory", "07 chronic disease", "10 contradictions"):
    assert rows[name]["status"] == "passed", rows[name]
assert os.path.getsize("lumen_scenario_reports.txt") > 5000
print("suite cell: 3 scripted scenarios passed, 12 unscripted reported as FAILED, cell raised at end")
