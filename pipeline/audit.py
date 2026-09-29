"""Scan a built directory (e.g. app/dist) for raw staff `reason` text.

    python -m pipeline.audit app/dist

Release gate: inspect generated bundles and downloads, not only the visible UI.
Requires the private source CSV locally.
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

from . import core, publish
from .build import ROOT, _path


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "app" / "dist"
    cfg = tomllib.loads((ROOT / "config" / "pipeline.toml").read_text(encoding="utf-8"))
    raw = core.read_raw(_path(cfg["inputs"]["reservations_csv"]))
    leaks = publish.audit_public(target, core.reason_strings(raw))
    files = sum(1 for p in target.rglob("*") if p.is_file())
    if leaks:
        print(f"FAIL: {len(leaks)} possible reason-text matches in {target}")
        for f, _ in leaks[:20]:
            print(f"  {f}")
        sys.exit(1)
    print(f"OK: scanned {files} files in {target}; no staff-note text found.")


if __name__ == "__main__":
    main()
