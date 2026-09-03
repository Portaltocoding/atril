"""De un MIDI tocado a un MusicXML legible.

Un MIDI grabado no trae ritmo notado: trae cuándo empieza y cuándo suelta cada
nota. Tocado staccato, cada corchea sale como semicorchea más silencio, y
music21 lo escribe tal cual: partitura ilegible y llena de silencios falsos.
Aquí se recupera el ritmo por donde sí es fiable, los ataques: cada nota dura
hasta que empieza la siguiente.
"""

import argparse
from pathlib import Path

from music21 import chord, converter, key, meter, note, stream


def limpiar(ruta_midi, compas="2/2"):
    origen = converter.parse(str(ruta_midi))
    notas = [n for n in origen.flatten().notesAndRests if not n.isRest]
    fin = float(origen.highestTime)

    # Notas que atacan a la vez son un acorde, no dos eventos.
    porOffset = {}
    for n in notas:
        porOffset.setdefault(round(float(n.offset), 4), []).extend(n.pitches)

    ataques = sorted(porOffset)
    parte = stream.Part()
    parte.insert(0, meter.TimeSignature(compas))
    parte.insert(0, key.Key(origen.analyze("key").tonic.name))
    for i, ataque in enumerate(ataques):
        alturas = porOffset[ataque]
        duracion = (ataques[i + 1] if i + 1 < len(ataques) else fin) - ataque
        # ponytail: si el MIDI trae silencios de verdad, se los come el legato;
        # esta pieza no tiene ninguno. Si aparece otra que sí, hará falta un
        # umbral de hueco en lugar de estirar siempre hasta el ataque siguiente.
        evento = (note.Note(alturas[0]) if len(alturas) == 1
                  else chord.Chord(list(alturas)))
        evento.quarterLength = duracion
        parte.insert(ataque, evento)

    partitura = stream.Score()
    partitura.insert(0, parte.makeNotation())
    return partitura


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("midi", type=Path)
    cli.add_argument("--out", type=Path, required=True)
    cli.add_argument("--compas", default="2/2")
    args = cli.parse_args()

    partitura = limpiar(args.midi, args.compas)
    partitura.write("musicxml", fp=str(args.out))
    print(f"{args.out}: {len(partitura.flatten().notes)} eventos")


if __name__ == "__main__":
    main()
