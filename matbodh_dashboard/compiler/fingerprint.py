"""Content fingerprints that identify identical engine configurations."""

from __future__ import annotations

import hashlib
import json


def fingerprint(
    config: dict, *, metadata_revision: int, engine_version: str, alliance_epoch: int
) -> str:
    """sha256 of the canonical JSON of the config plus everything that changes results."""
    payload = {
        "config": config,
        "metadata_revision": metadata_revision,
        "engine_version": engine_version,
        "alliance_epoch": alliance_epoch,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
