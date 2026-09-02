# Atril

Sistema de práctica de violín: lee una partitura, la recorre en pantalla al tempo, escucha lo que tocas y te dice dónde mover el dedo, en milímetros sobre el diapasón.

**Estado:** en construcción. Ahora mismo se está levantando el *andamiaje*: el primer escalón, sin ML ni LLM, donde una partitura digital se recorre sola en pantalla al tempo.

## Cómo está pensado

Dos piezas nunca se hablan directamente: una escribe un fichero JSON en disco y la otra lo lee. `timeline.json` entre el motor y el visor, `note_events.json` entre el escucha y el corrector. Esto permite depurar a ojo, sustituir cualquier pieza por un fichero escrito a mano, y cambiar de implementación sin que nadie más se entere.

## Documentación

- [`docs/andamiaje.md`](docs/andamiaje.md) — plan de obra del primer escalón, con el deep dive de arquitectura.
- [`docs/pasos.md`](docs/pasos.md) — receta de construcción: qué fichero crear, en qué orden y qué va dentro.
- [`docs/listener-ml.md`](docs/listener-ml.md) — el camino de ML del escucha, de pYIN a un modelo propio.

## Licencia

Apache-2.0. Copyright 2026 Carlos.
