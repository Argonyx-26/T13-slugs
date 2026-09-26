"""Rebuild clinical_safety_net_fixed.ipynb verbatim from its markdown text dump."""
import json
import re
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
text = src.read_text(encoding="utf-8")

header = re.compile(r"^## Cell (\d+) — (markdown|code)[ \t]*$", re.M)
matches = list(header.finditer(text))
declared = int(re.search(r"^Total cells: (\d+)$", text, re.M).group(1))
if len(matches) != declared:
    raise SystemExit(f"Found {len(matches)} cell headers, file declares {declared}.")

cells = []
for i, match in enumerate(matches):
    index, kind = int(match.group(1)), match.group(2)
    if index != i:
        raise SystemExit(f"Cell numbering gap at {i}: found {index}.")
    end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
    body = text[match.end():end]
    # Each cell block ends with a "---" separator line; drop it and surrounding blanks.
    body = re.sub(r"\n---\s*$", "", body.rstrip()).strip("\n")
    if kind == "code":
        fence = re.fullmatch(r"```python\n(.*)\n```", body, re.S)
        if not fence:
            raise SystemExit(f"Cell {index}: code block is not a single ```python fence.")
        body = fence.group(1)
    lines = body.splitlines(keepends=True)
    cell = {"cell_type": kind, "metadata": {}, "source": lines}
    if kind == "code":
        cell.update({"execution_count": None, "outputs": []})
    cells.append(cell)

notebook = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
        "accelerator": "GPU",
        "kaggle": {"accelerator": "nvidiaTeslaT4", "isInternetEnabled": True,
                   "isGpuEnabled": True, "language": "python", "sourceType": "notebook"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}
for n, cell in enumerate(cells):
    cell["id"] = f"cell-{n:02d}"
dst.write_text(json.dumps(notebook, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"Wrote {dst} with {len(cells)} cells "
      f"({sum(c['cell_type'] == 'code' for c in cells)} code, "
      f"{sum(c['cell_type'] == 'markdown' for c in cells)} markdown).")
