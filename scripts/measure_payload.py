"""Measure how large real engine results become as card payloads.

Developer tool, no database: it runs the real translator over an engine result file and
reports the payload's rows, JSON bytes and gzipped bytes. The spec (§6.3) asks for a compact
encoding to be chosen before shipping if a payload exceeds 2 MB gzipped.

    python scripts/measure_payload.py [--sample-dir ../MatBodh-Dash/sample-output]
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))  # lets the script import the exporter and the tests package
sys.path.insert(0, str(ROOT / "scripts"))

from export_card_fixtures import _observations, payload_from_result  # noqa: E402

DEFAULT_SAMPLE_DIR = ROOT.parent / "MatBodh-Dash" / "sample-output"
GZIP_LIMIT_BYTES = 2 * 1024 * 1024
# The samples the spec's size question is about: the largest distribution and gender results.
LARGE_SAMPLES = (("distribution", "result_ac_1.json"), ("gender_differential", "result_gd_complex.json"))
# The array holding each family's per-scenario results.
SCENARIO_ARRAYS = {"distribution": ("rows",), "opinion": ("scores",),
                   "gender_differential": ("gender_differentials",)}


def _first_scenario(result: dict, family: str) -> str:
    for array in SCENARIO_ARRAYS[family]:
        for item in result.get(array) or ():
            if item.get("scenario_id"):
                return item["scenario_id"]
    raise ValueError(f"No {family} scenario in this result")


def measure(sample_path: Path, family: str) -> dict:
    """Rows, JSON bytes and gzipped bytes of the standalone payload for one engine result."""
    result = json.loads(sample_path.read_text(encoding="utf-8"))
    observations = _observations(result)
    if not observations:
        raise ValueError(f"{sample_path.name} has no observations")
    fields = {"family": family, "scenarios": [_first_scenario(result, family)]}
    payload = payload_from_result(result, "measure", fields, observations[-1], None)
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {"rows": sum(len(cut["rows"]) for cut in payload["cuts"]),
            "json_bytes": len(text), "gzip_bytes": len(gzip.compress(text))}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sample-dir", type=Path, default=DEFAULT_SAMPLE_DIR)
    args = parser.parse_args(argv)
    over = False
    for family, name in LARGE_SAMPLES:
        size = measure(args.sample_dir / name, family)
        flag = " EXCEEDS 2 MB gzipped" if size["gzip_bytes"] > GZIP_LIMIT_BYTES else ""
        print(f"{name} ({family}): {size['rows']} rows, {size['json_bytes'] / 1e6:.2f} MB json, "
              f"{size['gzip_bytes'] / 1e6:.2f} MB gzip{flag}")
        over = over or bool(flag)
    return 1 if over else 0


if __name__ == "__main__":
    raise SystemExit(main())
