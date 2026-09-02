import json
from pathlib import Path

from engine.build import build_timeline

ESCALA = Path("data/pieces/escala-sol")


def test_engine_reproduce_el_contrato_escrito_a_mano():
    esperado = json.loads((ESCALA / "timeline.json").read_text())
    obtenido = build_timeline(ESCALA / "score.musicxml", piece="escala-sol")

    assert obtenido["piece"] == esperado["piece"]
    assert obtenido["tempo_map"] == esperado["tempo_map"]
    assert obtenido["tempo_source"] == "score"
    assert len(obtenido["events"]) == len(esperado["events"])

    for e, o in zip(esperado["events"], obtenido["events"]):
        assert o["index"] == e["index"]
        assert o["pitch"] == e["pitch"]
        assert o["measure"] == e["measure"]
        assert o["beat"] == e["beat"]
        assert o["start_s"] == e["start_s"]
        assert o["duration_s"] == e["duration_s"]
        if e["freq_hz"] is None:
            assert o["freq_hz"] is None
        else:
            assert abs(o["freq_hz"] - e["freq_hz"]) < 0.01


def test_bpm_de_la_cli_manda_sobre_el_fichero():
    obtenido = build_timeline(ESCALA / "score.musicxml", piece="escala-sol", bpm=120)

    assert obtenido["tempo_source"] == "cli"
    assert obtenido["tempo_map"] == [{"measure": 1, "bpm": 120}]
    assert obtenido["events"][1]["start_s"] == 0.5
