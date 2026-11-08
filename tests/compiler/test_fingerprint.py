from matbodh_dashboard.compiler.fingerprint import fingerprint

CFG = {"a": 1, "b": {"x": [1, 2], "y": None}}
KW = dict(metadata_revision=3, engine_version="1.0", alliance_epoch=2)


def test_fingerprint_stable_under_key_order():
    reordered = {"b": {"y": None, "x": [1, 2]}, "a": 1}
    assert fingerprint(CFG, **KW) == fingerprint(reordered, **KW)
    assert len(fingerprint(CFG, **KW)) == 64


def test_fingerprint_changes_with_revision_engine_and_epoch():
    base = fingerprint(CFG, **KW)
    assert fingerprint(CFG, **{**KW, "metadata_revision": 4}) != base
    assert fingerprint(CFG, **{**KW, "engine_version": "1.1"}) != base
    assert fingerprint(CFG, **{**KW, "alliance_epoch": 3}) != base
    assert fingerprint({**CFG, "a": 2}, **KW) != base
