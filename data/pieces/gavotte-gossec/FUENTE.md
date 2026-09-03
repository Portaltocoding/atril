# De dónde sale esta pieza

Gavotte de François-Joseph Gossec (1734-1829), dominio público.

Ninguna fuente gratuita publica el MusicXML: IMSLP, violinsheetmusic y
free-scores dan PDF, y MuseScore.com pide cuenta. Lo que sí hay es un MIDI:

- `gavotte.mid` — https://www.flutetunes.com/tunes.php?id=269 (Re mayor, 2/2)
- `score.musicxml` — generado con `uv run python engine/from_midi.py
  data/pieces/gavotte-gossec/gavotte.mid --out data/pieces/gavotte-gossec/score.musicxml`
- `timeline.json` — generado con `uv run python engine/build.py
  data/pieces/gavotte-gossec/score.musicxml --piece gavotte-gossec --bpm 144`

Dos cosas que no trae y conviene saber: es la versión en **Re** de flauta, no
la de Suzuki en **Sol**, y suena una octava por encima del registro habitual
del violín. Un MIDI tampoco guarda arcos, ligaduras ni digitaciones: la
partitura sale correcta de notas y seca de todo lo demás. Cuando haya una
engravada en MuseScore, sustituye a esta y `from_midi.py` deja de hacer falta.
