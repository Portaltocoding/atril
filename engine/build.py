"""De una partitura MusicXML a timeline.json, la frontera con el visor."""

import argparse
import json
from pathlib import Path

from music21 import converter, note, tempo

BPM_POR_DEFECTO = 100


def _resolver_tempo(partitura, bpm):
    if bpm is not None:
        return bpm, "cli"

    marcas = list(partitura.flatten().getElementsByClass(tempo.MetronomeMark))
    if marcas:
        return float(marcas[0].number), "score"

    return BPM_POR_DEFECTO, "default"


def build_timeline(ruta_musicxml, piece, bpm=None):
    partitura = converter.parse(str(ruta_musicxml))
    bpm, tempo_source = _resolver_tempo(partitura, bpm)
    segundos_por_negra = 60.0 / bpm

    if tempo_source == "default":
        print(
            f"aviso: {ruta_musicxml} no trae marca de tempo; asumiendo {bpm} bpm. "
            "Pasa --bpm si sabes el tempo real."
        )

    events = []
    for elemento in partitura.flatten().notesAndRests:
        es_silencio = isinstance(elemento, note.Rest)
        events.append(
            {
                "index": len(events),
                "pitch": None if es_silencio else elemento.pitch.nameWithOctave,
                "freq_hz": None if es_silencio else round(elemento.pitch.frequency, 2),
                "start_s": round(float(elemento.offset) * segundos_por_negra, 2),
                "duration_s": round(
                    float(elemento.duration.quarterLength) * segundos_por_negra, 2
                ),
                "measure": elemento.measureNumber,
                "beat": float(elemento.beat),
            }
        )

    return {
        "piece": piece,
        "tempo_map": [{"measure": 1, "bpm": bpm}],
        "tempo_source": tempo_source,
        "events": events,
    }


def main():
    parser = argparse.ArgumentParser(description="Genera timeline.json desde MusicXML.")
    parser.add_argument("musicxml", type=Path)
    parser.add_argument("--piece", required=True)
    parser.add_argument("--bpm", type=float, default=None)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    timeline = build_timeline(args.musicxml, piece=args.piece, bpm=args.bpm)
    destino = args.out or args.musicxml.parent / "timeline.json"
    destino.write_text(json.dumps(timeline, indent=2, ensure_ascii=False) + "\n")
    print(f"{destino}: {len(timeline['events'])} eventos, tempo de {timeline['tempo_source']}")


if __name__ == "__main__":
    main()
