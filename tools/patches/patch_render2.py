"""Patch 4: clearer fact lines and per-symptom denied/source lines in print_lumen_report."""
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

replace_in(17, '''        for fact in items:
            print(f"{pad}- [{fact['id']}] {who[fact['attribution']]}: {short(fact)} | "
                  f"timing: {fact['temporal_scope']} | source: {', '.join(fact['sources'])}")
''', '''        for fact in items:
            extra = details(fact)
            print(f"{pad}- {fact['category'].capitalize()} - {fact['status']}: {fact['name']}"
                  + (f" ({extra})" if extra else "")
                  + f" | {who[fact['attribution']]}, {fact['temporal_scope']}, "
                  f"{', '.join(fact['sources'])} [{fact['id']}]")
''')

replace_in(17, '''    for fact in symptoms:
        print(f"  {fact['name']} [{fact['id']}] - {fact['status']}")
        if fact["status"] == "denied":
            print("    Explicitly denied; characteristics not applicable.")
            continue
''', '''    for fact in symptoms:
        print(f"  {fact['name']} [{fact['id']}]")
        print(f"    Explicitly denied: {'Yes' if fact['status'] == 'denied' else 'No'}")
        print(f"    Source: {who[fact['attribution']]} ({', '.join(fact['sources'])})")
        if fact["status"] == "denied":
            continue
        if fact["status"] == "uncertain":
            print("    Status: uncertain; verify with the patient.")
''')

path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print("Patched cell 17 renderer in", path.name)
