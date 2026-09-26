"""Static validation of clinical_safety_net_fixed.ipynb against prompt.txt section 38."""
import ast
import json
import re
import sys
from pathlib import Path

nb_path, md_path = Path(sys.argv[1]), Path(sys.argv[2])
nb = json.loads(nb_path.read_text(encoding="utf-8"))          # 1. valid JSON
md = md_path.read_text(encoding="utf-8")
cells = nb["cells"]
code = ["".join(c["source"]) for c in cells if c["cell_type"] == "code"]
full = "\n\n".join(code)
failures = []

def check(ok, label):
    print(("PASS " if ok else "FAIL ") + label)
    if not ok:
        failures.append(label)

check(nb["nbformat"] == 4 and all("source" in c for c in cells), "notebook is nbformat 4 JSON")

# Verbatim round-trip: every cell's text must appear unchanged in the markdown.
for i, c in enumerate(cells):
    src = "".join(c["source"])
    needle = f"```python\n{src}\n```" if c["cell_type"] == "code" else src
    if needle not in md:
        check(False, f"cell {i} verbatim match with markdown")
check(not [f for f in failures if "verbatim" in f], "all 23 cells verbatim-identical to markdown")

for i, src in enumerate(code):                                  # 2. syntax
    try:
        ast.parse(src)
    except SyntaxError as exc:
        check(False, f"code cell {i} syntax: {exc}")
check(not [f for f in failures if "syntax" in f], "every code cell is syntactically valid")

# 3. imports: every imported top-level module, and every name used is defined somewhere.
tree = ast.parse(full)
imported = set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        imported |= {a.name.split(".")[0] for a in node.names}
    elif isinstance(node, ast.ImportFrom):
        imported.add(node.module.split(".")[0])
print("     imported modules:", sorted(imported))
defined = set(dir(__builtins__)) | {"__name__"}
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
        defined.add(node.name)
        defined |= {a.arg for a in node.args.args + node.args.kwonlyargs} if isinstance(node, ast.FunctionDef) else set()
    elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
        defined.add(node.id)
    elif isinstance(node, (ast.Import, ast.ImportFrom)):
        defined |= {(a.asname or a.name).split(".")[0] for a in node.names}
    elif isinstance(node, ast.arg):
        defined.add(node.arg)
    elif isinstance(node, ast.ExceptHandler) and node.name:
        defined.add(node.name)
used = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
undefined = sorted(used - defined)
check(not undefined, f"no undefined names across cells {undefined or ''}")

check(re.search(r'MODEL_ID = "aaditya/Llama3-OpenBioLLM-8B"', full) is not None
      and full.count("Llama3-OpenBioLLM") == 1, "4. model ID exactly aaditya/Llama3-OpenBioLLM-8B")
check('QUANTIZATION = "8bit"' in full and "load_in_8bit=True" in full and "load_in_4bit=True" in full
      and 'bnb_4bit_quant_type="nf4"' in full and 'not in {"8bit", "4bit"}' in full,
      "5. quantization config 8bit default + NF4 fallback, validated")
check('device_map="auto"' in full and "hf_device_map" in full and "set(counts) != {0, 1}" in full,
      "6. device_map='auto' + hard two-GPU placement check")
check(re.search(r"model\.generate\(\s*inputs\s*\)", full) is None
      and "input_ids=inputs[\"input_ids\"]" in full and "attention_mask=inputs[\"attention_mask\"]" in full,
      "7. generate() receives input_ids/attention_mask, not a BatchEncoding")
check("if not tokenizer.chat_template:" in full and "add_generation_prompt=True" in full,
      "8. existing chat template preserved; fallback only when absent")
check("output[0, input_token_count:]" in full, "9. only newly generated tokens decoded")
check("do_sample=False" in full, "23. deterministic generation (do_sample=False)")
for n, fn in enumerate(["extract_facts", "analyze_facts", "build_report", "check_report"], 10):
    pass
check(all(f"def {fn}(" in full for fn in ("extract_facts", "analyze_facts", "build_report", "check_report")),
      "10. stages: extraction, analysis, report, quality check")
for key in ("summary", "symptoms", "vitals", "health_information", "medications", "allergies",
            "clinical_findings", "investigations", "potential_risks", "urgency_indicators",
            "missing_information", "contradictions", "clinical_note", "symptom_review",
            "medication_review", "peer_review", "verification_items"):
    if f'"{key}":' not in full:
        check(False, f"result key {key}")
check(not [f for f in failures if f.startswith("result key")], "11-24. all required result sections present")
check("def no_dialogue(" in full and "DIALOGUE.search" in full, "25. dialogue-continuation guard")
check("json.dumps(result, allow_nan=False)" in full, "26. JSON-serializability check")
check('def analyze_consultation(transcript, patient_history="", retrieved_context=""):' in full,
      "27-28. analyze_consultation(transcript, patient_history='', retrieved_context='')")
check(len(re.findall(r'"name": "\d\d ', full)) == 15, "15 synthetic test scenarios")
placeholders = [p for p in ("TODO", "YOUR_CODE_HERE", "IMPLEMENT_THIS") if p in full]
bare_ellipsis = [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and n.value is Ellipsis]
check(not placeholders and not bare_ellipsis, "no placeholder code (TODO / ... / YOUR_CODE_HERE)")
check(nb_path.suffix == ".ipynb" and nb_path.stat().st_size > 0, f"30. saved as {nb_path.name}")
print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
