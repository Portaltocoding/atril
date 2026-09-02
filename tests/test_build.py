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
    assert len(obtenido["parts"]) == 1

    esperados = esperado["parts"][0]["events"]
    obtenidos = obtenido["parts"][0]["events"]
    assert len(obtenidos) == len(esperados)

    for e, o in zip(esperados, obtenidos):
        assert o["index"] == e["index"]
        assert o["pitch"] == e["pitch"]
        assert o["measure"] == e["measure"]
        assert o["beat"] == e["beat"]
        assert o["start_s"] == e["start_s"]
        assert o["duration_s"] == e["duration_s"]
        assert len(o["freq_hz"]) == len(e["freq_hz"])
        for f_obtenida, f_esperada in zip(o["freq_hz"], e["freq_hz"]):
            assert abs(f_obtenida - f_esperada) < 0.01


def test_bpm_de_la_cli_manda_sobre_el_fichero():
    obtenido = build_timeline(ESCALA / "score.musicxml", piece="escala-sol", bpm=120)

    assert obtenido["tempo_source"] == "cli"
    assert obtenido["tempo_map"] == [{"measure": 1, "bpm": 120}]
    assert obtenido["parts"][0]["events"][1]["start_s"] == 0.5


def test_todas_las_voces_y_los_acordes_como_un_solo_evento():
    mozart = Path("data/pieces/mozart-k155/score.musicxml")
    timeline = build_timeline(mozart, piece="mozart-k155", bpm=120)

    assert [p["name"] for p in timeline["parts"]] == [
        "Violin I",
        "Violin II",
        "Viola",
        "Cello",
    ]

    violin_i = timeline["parts"][0]["events"]
    acordes = [e for e in violin_i if len(e["pitch"]) > 1]
    assert acordes, "la parte de Violin I del K155 tiene dobles cuerdas"
    for acorde in acordes:
        assert len(acorde["pitch"]) == len(acorde["freq_hz"])
        assert acorde["freq_hz"] == sorted(acorde["freq_hz"])
