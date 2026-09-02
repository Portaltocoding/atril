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


def _eventos_de(parte, segundos_por_negra):
    events = []
    for elemento in parte.flatten().notesAndRests:
        # pitch es siempre una lista: vacía si es silencio, con varias notas si
        # es un acorde (en violín, una doble cuerda). Así nadie ramifica por tipo.
        alturas = (
            []
            if isinstance(elemento, note.Rest)
            else sorted(elemento.pitches, key=lambda p: p.frequency)
        )
        events.append(
            {
                "index": len(events),
                "pitch": [p.nameWithOctave for p in alturas],
                "freq_hz": [round(p.frequency, 2) for p in alturas],
                "start_s": round(float(elemento.offset) * segundos_por_negra, 2),
                "duration_s": round(
                    float(elemento.duration.quarterLength) * segundos_por_negra, 2
                ),
                "measure": elemento.measureNumber,
                "beat": float(elemento.beat),
            }
        )
    return events


def build_timeline(ruta_musicxml, piece, bpm=None):
    partitura = converter.parse(str(ruta_musicxml))
    bpm, tempo_source = _resolver_tempo(partitura, bpm)
    segundos_por_negra = 60.0 / bpm

    if tempo_source == "default":
        print(
            f"aviso: {ruta_musicxml} no trae marca de tempo; asumiendo {bpm} bpm. "
            "Pasa --bpm si sabes el tempo real."
        )

    # Se emiten todas las partes: quién toca cuál se decide al practicar, no aquí.
    partes = list(partitura.parts) or [partitura]

    return {
        "piece": piece,
        "tempo_map": [{"measure": 1, "bpm": bpm}],
        "tempo_source": tempo_source,
        "parts": [
            {
                "name": parte.partName or f"parte {i + 1}",
                "events": _eventos_de(parte, segundos_por_negra),
            }
            for i, parte in enumerate(partes)
        ],
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

    resumen = ", ".join(
        f"{p['name']} ({len(p['events'])} eventos)" for p in timeline["parts"]
    )
    print(f"{destino}: {resumen}; tempo de {timeline['tempo_source']}")


if __name__ == "__main__":
    main()
