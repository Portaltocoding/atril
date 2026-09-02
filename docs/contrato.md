# El contrato: `timeline.json`

La frontera entre el motor y todo lo demás. El motor lo escribe, el visor lo lee, y mañana el corrector lo leerá también. Este documento manda sobre `andamiaje.md` y `pasos.md` en todo lo que se refiera a la forma del fichero: aquellos son el plan, este es lo que existe.

## Forma

```json
{
  "piece": "mozart-k155",
  "tempo_map": [ { "measure": 1, "bpm": 120 } ],
  "tempo_source": "cli",
  "parts": [
    {
      "name": "Violin I",
      "events": [
        {
          "index": 0,
          "pitch": ["A4", "A5"],
          "freq_hz": [440.0, 880.0],
          "start_s": 0.0,
          "duration_s": 0.5,
          "measure": 1,
          "beat": 1.0
        }
      ]
    }
  ]
}
```

## Reglas, y por qué

**`pitch` es siempre una lista.** Vacía si el evento es un silencio, con una nota si es una nota, con varias si es un acorde (en violín, una doble cuerda). Nadie tiene que preguntarse si el campo trae `null`, texto o lista: solo mira si está vacía. Las frecuencias van ordenadas de grave a aguda y en el mismo orden que `pitch`.

**Los silencios son eventos.** No se deducen restando tiempos. Cuesta que todo consumidor tenga que filtrarlos, y compra que el visor avance sin lógica de huecos y que la partitura quede representada entera.

**Un evento es un instante de una voz, no una nota suelta.** Un acorde es un evento, no tres. Esto mantiene la correspondencia entre el timeline y lo que el usuario ve como "un sitio de la partitura".

**El fichero lleva todas las voces.** El motor no elige por ti: emite `parts` completo y la elección de qué línea sigues se hace al practicar, en el visor. Construir una vez, elegir cada vez.

**`tempo_source` dice de dónde salió el tempo.** Uno de `cli` (lo pasaste tú), `score` (marca de metrónomo del MusicXML) o `default` (nadie lo sabía; el motor asumió 100 bpm y avisó por consola). Sin este campo, un timeline calculado a ciegas es indistinguible de uno correcto, que es el fallo más caro de los que existen aquí.

El hueco que queda a propósito: cuando el fichero no trae tempo, la cadena debería preguntar antes de rendirse *qué obra es esta y a qué tempo se toca*. Eso entra en el MVP como una llamada al LLM cacheada por pieza, y añadirá un cuarto valor a `tempo_source`. Hasta entonces, el motor avisa en vez de inventar.

**`measure` y `beat` no son decorativos.** `start_s` mueve el reloj, pero `measure`/`beat` son el enganche con la partitura dibujada: sirven para "saltar al compás 12" y para que el cursor sepa dónde está en tiempo musical, no en segundos.

## Quién lo toca

- Lo escribe `engine/build.py`, y solo él.
- Lo valida `server/app.py` con Pydantic al servirlo: si el motor produjera un fichero fuera de contrato, la API devuelve un 500 en vez de pasarle basura al visor.
- Lo consume `viewer/app.js`, que decide qué voz seguir y cuándo avanzar el puntero.
- `viewer/score-view.js` no lo ve nunca: recibe un tiempo musical y punto.

## Lo que se aprendió construyéndolo

El cursor de OSMD **no avanza nota a nota de una parte**: avanza instante a instante de la partitura completa. Con una sola voz, el índice del evento y los pasos del cursor coinciden y todo parece funcionar; con un cuarteto se desincronizan a la primera nota que tenga la viola y no el violín. Por eso el visor posiciona el cursor por tiempo musical (`start_s × bpm / 60`, en negras) en vez de contar pasos.

Esa suposición tiene un límite conocido: vale mientras `tempo_map` tenga una sola entrada. El día que una pieza cambie de tempo a mitad, la conversión de segundos a negras deja de ser una multiplicación y hay que recorrer el mapa.
