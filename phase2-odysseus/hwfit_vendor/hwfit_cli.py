#!/usr/bin/env python3
"""Nightjar hardware model-fit CLI — replaces the old hw-detect.mjs.

Backed by llmfit (© 2026 Alex Jones, MIT; vendored from Odysseus services/hwfit).
Pure stdlib, no venv needed. Detects RAM/VRAM/GPU and ranks which local models
FIT this machine (quant + context + run mode + speed). Prints a human summary
and, with --json, a machine-readable blob for the OpenCode startup hardware plugin.

Usage: python3 hwfit_cli.py [--json] [--limit N] [--use-case coding]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from services.hwfit.fit import rank_models          # noqa: E402
from services.hwfit.hardware import detect_system    # noqa: E402


def main():
    as_json = "--json" in sys.argv
    limit = 5
    use_case = None
    for i, a in enumerate(sys.argv):
        if a == "--limit" and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])
        if a == "--use-case" and i + 1 < len(sys.argv):
            use_case = sys.argv[i + 1]

    system = detect_system()
    ranked = rank_models(system, use_case=use_case, limit=limit, fit_only=True)

    if as_json:
        print(json.dumps({"system": system, "top": ranked}, default=str))
        return

    print("=== Nightjar hardware fit (llmfit) ===")
    for k in ("gpus", "vram_gb", "ram_gb", "cpu", "backend", "platform"):
        if k in system:
            print(f"  {k:10}: {system[k]}")
    print(f"\nTop {len(ranked)} models that FIT this machine"
          + (f" for '{use_case}'" if use_case else "") + ":")
    for m in ranked:
        print(f"  - {m.get('name'):<40} {m.get('quant','?'):<10} "
              f"ctx={m.get('context','?')} fit={m.get('fit_level','?')} "
              f"mode={m.get('run_mode','?')} ~{m.get('speed_tps','?')}tps score={m.get('score','?')}")


if __name__ == "__main__":
    main()
