# Atril

Sistema de práctica de violín: lee una partitura, la recorre en pantalla al tempo, escucha lo que tocas y te dice dónde mover el dedo, en milímetros sobre el diapasón.

**Estado:** andamiaje funcionando. Una partitura se dibuja en pantalla y su cursor avanza al tempo, eligiendo qué voz sigues. Sin ML ni LLM todavía.

```bash
uv run python -m engine.build data/pieces/mozart-k155/score.musicxml --piece mozart-k155 --bpm 120
uv run uvicorn server.app:app --port 8000
# abrir http://localhost:8000/?piece=mozart-k155
```

Si solo hay un MIDI de la pieza, `engine/from_midi.py` lo convierte antes en un MusicXML legible.

## Cómo está pensado

Dos piezas nunca se hablan directamente: una escribe un fichero JSON en disco y la otra lo lee. `timeline.json` entre el motor y el visor, `note_events.json` entre el escucha y el corrector. Esto permite depurar a ojo, sustituir cualquier pieza por un fichero escrito a mano, y cambiar de implementación sin que nadie más se entere.

## Documentación

- [`docs/arquitectura.md`](docs/arquitectura.md) — cómo funciona por dentro: carpetas, stack, motor, fronteras y el recorrido completo de una ejecución. Versión de lectura, en formato Cornell y con los conceptos explicados: [Atril por dentro](https://claude.ai/code/artifact/f8c03291-1e25-4e4c-9edf-1f435e79ec41).
- [`docs/contrato.md`](docs/contrato.md) — la frontera: qué hay dentro de `timeline.json`, y por qué cada campo es como es.
- [`docs/andamiaje.md`](docs/andamiaje.md) — plan de obra del primer escalón, con el deep dive de arquitectura.
- [`docs/pasos.md`](docs/pasos.md) — receta de construcción: qué fichero crear, en qué orden y qué va dentro.
- [`docs/listener-ml.md`](docs/listener-ml.md) — el camino de ML del escucha, de pYIN a un modelo propio.

## Licencia

Apache-2.0. Copyright 2026 Carlos.
