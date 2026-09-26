"""Render a report from hand-built validated facts using the notebook's own code (no model)."""
import copy
import json
import sys

nb = json.load(open(sys.argv[1], encoding="utf-8"))
ns = {}
for index in (5, 11, 13, 15, 17):
    exec("".join(nb["cells"][index]["source"]), ns)
SourceUnit, ND = ns["SourceUnit"], ns["ND"]

transcript = (
    "PATIENT: I have a mild cough and feel very tired for three days.\n"
    "PATIENT: I do not have chest pain or difficulty breathing.\n"
    "DOCTOR: We will check your temperature and other vital signs.\n"
    "PATIENT: I am not taking any medications. I have no known allergies."
)
units = [SourceUnit(f"transcript:{i}", "transcript", line)
         for i, line in enumerate(transcript.splitlines(keepends=True), 1)]

def fact(category, name, status, attribution, unit, quote, temporal="current", **attributes):
    return {"category": category, "name": name, "status": status, "temporal_scope": temporal,
            "attribution": attribution, "attributes": attributes,
            "evidence": [{"unit_id": f"transcript:{unit}", "quote": quote}]}

raw = [
    fact("symptom", "cough", "reported", "patient", 1,
         "I have a mild cough and feel very tired for three days.",
         severity="mild", duration="three days", onset="three days ago"),
    fact("symptom", "tired", "reported", "patient", 1,
         "I have a mild cough and feel very tired for three days.",
         severity="very", duration="three days"),
    fact("symptom", "chest pain", "denied", "patient", 2,
         "I do not have chest pain or difficulty breathing."),
    fact("symptom", "difficulty breathing", "denied", "patient", 2,
         "I do not have chest pain or difficulty breathing."),
    fact("vital", "temperature", "planned", "clinician", 3,
         "We will check your temperature and other vital signs.", temporal="future",
         kind="temperature"),
    fact("medication", "medications", "denied", "patient", 4, "I am not taking any medications."),
    fact("allergy", "no known allergies", "denied", "patient", 4, "I have no known allergies."),
    fact("plan", "check your temperature and other vital signs", "planned", "clinician", 3,
         "We will check your temperature and other vital signs.", temporal="future"),
]
for item in raw:
    ns["validate_fact_page"]({"facts": [item], "has_more": False}, tuple(ns["ATTRIBUTES"]), units)
facts = []
for index, item in enumerate(raw, 1):
    item["attributes"] = {key: item["attributes"].get(key, ND) for key in ns["ATTRIBUTES"][item["category"]]}
    item["id"] = f"F{index:04d}"
    item["sources"] = ["transcript"]
    item["attribution_note"] = "Source-linked; clinician verification required."
    facts.append(item)

analysis = {
    "concerns": [{
        "category": "missing_critical_information", "fact_ids": ["F0001", "F0002"],
        "knowledge_ids": [],
        "potential_concern": "Respiratory symptom with fatigue and no documented vital signs.",
        "reason": "Vital signs have not yet been measured, so severity cannot be assessed.",
        "what_to_verify": ["Record temperature, oxygen saturation and respiratory rate."],
        "attention": "Routine clinician review",
    }],
    "missing_information": [{"field": "Oxygen saturation", "reason": "Relevant to cough.",
                             "fact_ids": ["F0001"], "status": ND, "basis": "Model-proposed"}],
    "contradictions": [],
    "verification_items": [{"question": "Confirm the cough is not productive.", "fact_ids": ["F0001"]}],
}
result = ns["build_report"](facts, analysis, [])
for item in facts:
    for removed in item.get("ungrounded_attributes_removed", []):
        result["quality"]["warnings"].append(f"{item['id']} removed {removed}")
ns["check_report"](result, units, transcript)
json.dumps(result, allow_nan=False)
ns["print_lumen_report"](result)
