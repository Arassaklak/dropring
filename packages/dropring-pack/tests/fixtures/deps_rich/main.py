# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "rich>=13",
# ]
# ///
"""rich renders a table with Unicode box drawing; the dependency comes from the PEP 723 block."""

import io
import json

from rich.console import Console
from rich.table import Table

console = Console(file=io.StringIO(), record=True, width=60, color_system=None)
table = Table(title="dropring-pack")
table.add_column("dil")
table.add_column("durum")
table.add_row("Türkçe", "çalışıyor ✓")
console.print(table)
text = console.export_text()
print(json.dumps({"title": "dropring-pack" in text, "row": "çalışıyor ✓" in text, "box": "━" in text or "─" in text}, ensure_ascii=False))
