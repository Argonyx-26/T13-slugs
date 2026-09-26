"""Patch 1: ungrounded attribute values become 'Not documented' plus a visible quality warning."""
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
nb = json.loads(path.read_text(encoding="utf-8"))
cells = nb["cells"]

def replace_in(index, old, new):
    src = "".join(cells[index]["source"])
    if src.count(old) != 1:
        raise SystemExit(f"cell {index}: expected exactly one match, found {src.count(old)}")
    cells[index]["source"] = src.replace(old, new).splitlines(keepends=True)

replace_in(12, (
    "Names and non-missing attribute values are grounded to literal cited text.\n"
), (
    "Names and non-missing attribute values are grounded to literal cited text.\n"
    "An attribute value that cannot be grounded is replaced with `Not documented`\n"
    "and reported as a quality warning (with the rejected model value) instead of\n"
    "aborting the run; evidence quotes and fact names must still match exactly.\n"
))

replace_in(13, (
    "        if not isinstance(attributes, dict) or set(attributes) - set(ATTRIBUTES[category]):\n"
    "            raise StructuredOutputError(f\"Unexpected attributes for {category}.\")\n"
    "        for key, value in attributes.items():\n"
), (
    "        if not isinstance(attributes, dict) or set(attributes) - set(ATTRIBUTES[category]):\n"
    "            raise StructuredOutputError(f\"Unexpected attributes for {category}.\")\n"
    "        removed = []\n"
    "        for key, value in attributes.items():\n"
))
replace_in(13, (
    "                grounded_value = ground_value(value, quotes)\n"
    "                if grounded_value is None:\n"
    "                    raise StructuredOutputError(\n"
    "                        f\"Fact {fact['name']!r}: attribute {key}={value!r} lacks \"\n"
    "                        f\"verbatim evidence. Cited text: {quotes!r}. \"\n"
    "                        \"Copy the supported source phrase into the appropriate attribute; \"\n"
    "                        \"omit only details that are genuinely not documented.\"\n"
    "                    )\n"
    "                attributes[key] = grounded_value\n"
), (
    "                grounded_value = ground_value(value, quotes)\n"
    "                if grounded_value is None:\n"
    "                    # Never keep an unsupported detail, but do not discard the whole\n"
    "                    # fact either: the rejection is reported as a quality warning.\n"
    "                    removed.append({\"attribute\": key, \"rejected_model_value\": value})\n"
    "                    attributes[key] = ND\n"
    "                else:\n"
    "                    attributes[key] = grounded_value\n"
    "        if removed:\n"
    "            fact[\"ungrounded_attributes_removed\"] = removed\n"
))

replace_in(17, (
    "    result = build_report(facts, analysis, knowledge_units)\n"
    "    check_report(result, source_units, transcript)\n"
), (
    "    result = build_report(facts, analysis, knowledge_units)\n"
    "    for fact in facts:\n"
    "        for item in fact.get(\"ungrounded_attributes_removed\", []):\n"
    "            result[\"quality\"][\"warnings\"].append(\n"
    "                f\"{fact['id']} {fact['name']!r}: model value {item['rejected_model_value']!r} \"\n"
    "                f\"for {item['attribute']} is not in the cited evidence and was replaced \"\n"
    "                \"with Not documented. Verify this detail against the source.\"\n"
    "            )\n"
    "    check_report(result, source_units, transcript)\n"
))

path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print("Patched cells 12, 13, 17 in", path.name)
