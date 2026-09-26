"""Exercise the patched validate_fact_page on the fact that failed on Kaggle."""
import json
import sys

nb = json.load(open(sys.argv[1], encoding="utf-8"))
ns = {}
for index in (5, 11, 13):
    exec("".join(nb["cells"][index]["source"]), ns)

unit = ns["SourceUnit"]("transcript:1", "transcript",
                        "PATIENT: I have a mild cough and feel very tired for three days.\n")
page = {"has_more": False, "facts": [{
    "category": "symptom", "name": "cough", "status": "reported",
    "temporal_scope": "current", "attribution": "patient",
    "attributes": {"onset": "three days ago", "duration": "three days", "severity": "mild"},
    "evidence": [{"unit_id": "transcript:1",
                  "quote": "I have a mild cough and feel very tired for three days."}],
}]}
ns["validate_fact_page"](page, ("symptom", "vital"), [unit])
fact = page["facts"][0]
assert fact["attributes"] == {"onset": "Not documented", "duration": "three days", "severity": "mild"}, fact
assert fact["ungrounded_attributes_removed"] == [
    {"attribute": "onset", "rejected_model_value": "three days ago"}], fact
print("ungrounded attribute -> Not documented + recorded:", fact["ungrounded_attributes_removed"])

# Still strict: an ungrounded fact name must raise.
bad = json.loads(json.dumps(page))
bad["facts"][0]["name"] = "bronchitis"
bad["facts"][0].pop("ungrounded_attributes_removed")
try:
    ns["validate_fact_page"](bad, ("symptom", "vital"), [unit])
    raise SystemExit("FAIL: ungrounded name accepted")
except ns["StructuredOutputError"] as exc:
    print("ungrounded name still rejected:", exc)

# Still strict: a measured vital whose value is ungrounded must raise.
vital_unit = ns["SourceUnit"]("transcript:2", "transcript", "DOCTOR: Temperature measured now is 39.2 C.\n")
vital = {"has_more": False, "facts": [{
    "category": "vital", "name": "Temperature", "status": "measured",
    "temporal_scope": "current", "attribution": "clinician",
    "attributes": {"kind": "temperature", "value": "38.5", "unit": "C"},
    "evidence": [{"unit_id": "transcript:2", "quote": "Temperature measured now is 39.2 C."}],
}]}
try:
    ns["validate_fact_page"](vital, ("symptom", "vital"), [vital_unit])
    raise SystemExit("FAIL: invented vital value accepted")
except ns["StructuredOutputError"] as exc:
    print("invented vital value still rejected:", exc)
print("ALL VALIDATOR CHECKS PASSED")
