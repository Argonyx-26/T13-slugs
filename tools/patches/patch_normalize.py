"""Patch 5: exact-after-normalization mapping of enum values, relaxed page sizes,
and conflict markers on contradicted facts in the rendered report."""
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
nb = json.loads(path.read_text(encoding="utf-8"))
cells = nb["cells"]

def replace_in(index, old, new):
    src = "".join(cells[index]["source"])
    if src.count(old) != 1:
        raise SystemExit(f"cell {index}: expected exactly one match, found {src.count(old)}:\n{old[:150]}")
    cells[index]["source"] = src.replace(old, new).splitlines(keepends=True)

# cell 11: shared helper (cells 13 and 15 both use it)
replace_in(11, '''def require_list(value, context):''', '''def canonical_choice(value, allowed):
    """Map a case/spacing/punctuation variant onto the one allowed value it equals.
    Anything else is returned unchanged, so validation still rejects it."""
    if not isinstance(value, str):
        return value
    def normalize(text):
        return " ".join(re.sub(r"[^a-z0-9]+", " ", text.casefold()).split())
    matches = [item for item in allowed if normalize(item) == normalize(value)]
    return matches[0] if len(matches) == 1 else value

def require_list(value, context):''')

# cell 13: extraction validation
replace_in(13, '''    if len(data["facts"]) > 4:
        raise StructuredOutputError("Return at most four facts per page.")
''', '''    # The prompt asks for 4 per page; a complete longer page is still usable.
    if len(data["facts"]) > 8:
        raise StructuredOutputError("Return at most four facts per page.")
''')
replace_in(13, '''        category = fact["category"]
        if not isinstance(category, str) or category not in allowed:
''', '''        fact["category"] = canonical_choice(fact["category"], allowed)
        category = fact["category"]
        if not isinstance(category, str) or category not in allowed:
''')
replace_in(13, '''        if not isinstance(fact["status"], str) or fact["status"] not in STATUSES[category]:
''', '''        fact["status"] = canonical_choice(fact["status"], STATUSES[category])
        fact["temporal_scope"] = canonical_choice(
            fact["temporal_scope"], ("current", "historical", "future", "uncertain"))
        fact["attribution"] = canonical_choice(
            fact["attribution"], ("patient", "clinician", "record", "uncertain"))
        if not isinstance(fact["status"], str) or fact["status"] not in STATUSES[category]:
''')
replace_in(13, '''DOMAINS = [''', '''# Canonical labels only; the measured value itself must still be verbatim evidence.
VITAL_SYNONYMS = {
    "pulse": "heart rate", "pulse rate": "heart rate", "hr": "heart rate",
    "spo2": "oxygen saturation", "sao2": "oxygen saturation", "sats": "oxygen saturation",
    "o2 saturation": "oxygen saturation", "oxygen sat": "oxygen saturation",
    "bp": "blood pressure", "rr": "respiratory rate", "breathing rate": "respiratory rate",
    "temp": "temperature", "glucose": "blood glucose", "blood sugar": "blood glucose",
}
DOMAINS = [''')
replace_in(13, '''            if category == "vital" and key == "kind":
                if value not in VITAL_KINDS:
''', '''            if category == "vital" and key == "kind":
                value = attributes[key] = VITAL_SYNONYMS.get(
                    " ".join(value.casefold().split()), canonical_choice(value, VITAL_KINDS))
                if value not in VITAL_KINDS:
''')

# cell 15: analysis validation
replace_in(15, '''    if sum(len(data[key]) for key in data if key != "has_more") > 3:
''', '''    # The prompt asks for 3 per page; a complete longer page is still usable.
    if sum(len(data[key]) for key in data if key != "has_more") > 6:
''')
replace_in(15, '''        }, "concern")
        if not isinstance(item["category"], str) or item["category"] not in CONCERN_CATEGORIES:
''', '''        }, "concern")
        item["category"] = canonical_choice(item["category"], CONCERN_CATEGORIES)
        item["attention"] = canonical_choice(item["attention"], ATTENTION)
        if not isinstance(item["category"], str) or item["category"] not in CONCERN_CATEGORIES:
''')

# cell 17: conflict markers in the readable report
replace_in(17, '''    def heading(title):
        print("\\n" + title + "\\n" + "-" * len(title))
''', '''    def heading(title):
        print("\\n" + title + "\\n" + "-" * len(title))

    conflicted = {key for item in result["contradictions"] for key in item["fact_ids"]}
''')
replace_in(17, '''                  + f" | {who[fact['attribution']]}, {fact['temporal_scope']}, "
                  f"{', '.join(fact['sources'])} [{fact['id']}]")
''', '''                  + f" | {who[fact['attribution']]}, {fact['temporal_scope']}, "
                  f"{', '.join(fact['sources'])} [{fact['id']}]"
                  + (" | CONFLICTING - see section 12" if fact["id"] in conflicted else ""))
''')

path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print("Patched cells 11, 13, 15, 17 in", path.name)
