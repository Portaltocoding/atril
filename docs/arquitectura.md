# Cómo funciona Atril por dentro

Documento de referencia del sistema **tal como está construido**: qué hay en cada carpeta y por qué, por qué se eligió cada pieza del stack, cómo está montado el motor, qué protege cada frontera, y el recorrido completo de una ejecución desde que escribes el comando hasta que el cursor se mueve y suena una nota.

Si algo de aquí contradice a `andamiaje.md` o `pasos.md`, manda este documento: aquellos son el plan, este es lo que existe. La forma exacta del fichero de frontera está en [contrato.md](contrato.md).

---

## 1. El esquema de carpetas

```
atril/
├── engine/            Python. Convierte partituras en datos.
│   ├── __init__.py
│   └── build.py       MusicXML → timeline.json. Único que escribe el contrato.
├── server/            Python. Sirve datos y estáticos, y valida el contrato.
│   └── app.py         FastAPI: 3 endpoints + el visor montado en la raíz.
├── viewer/            Navegador. Lo que ves y lo que oyes.
│   ├── index.html     Estructura y controles. Carga los scripts en orden.
│   ├── app.js         El reloj, el puntero y quién manda sobre los demás.
│   ├── score-view.js  Único fichero que sabe que OSMD existe.
│   ├── audio.js       Único fichero que sabe que Web Audio existe.
│   └── vendor/        Librerías guardadas en el repo, no descargadas al vuelo.
├── data/pieces/       Los datos. Una carpeta por pieza.
│   └── <pieza>/
│       ├── score.musicxml   La partitura (entrada).
│       └── timeline.json    Lo que produce el motor (salida y frontera).
├── tests/
│   └── test_build.py  El examen del motor contra valores conocidos.
├── docs/              Estos documentos.
├── pyproject.toml     Dependencias, versión de Python, config de pytest.
└── uv.lock            El árbol exacto de versiones, para reconstruirlo idéntico.
```

**Por qué está partido así.** Cada carpeta de primer nivel es un sitio donde el código se ejecuta o un sitio donde viven los datos, y ninguna sabe cómo funciona la otra por dentro:

- `engine/` corre en tu terminal, cuando tú quieres, y puede tardar. Es la fase de **preparación**.
- `server/` y `viewer/` corren mientras practicas y tienen que ser rápidos y deterministas. Es la fase de **ejecución**.
- `data/` es lo único que las une. Nada de lo que pasa en `engine/` llega al `viewer/` si no está escrito en un fichero de `data/`.

Esa separación es la que permite que el motor tarde diez segundos, o que mañana llame a un LLM, sin que al visor le tiemble el cursor: cuando el visor arranca, el trabajo lento ya pasó y solo queda leer un JSON.

**Por qué una carpeta por pieza y no una base de datos.** A una pieza se llega siempre por su nombre (`data/pieces/mozart-k155/`), nunca preguntando "dime las piezas que cumplan X". Cuando la búsqueda es por clave conocida, una carpeta es un índice perfecto, gratis, y además puedes abrir el fichero y mirarlo con los ojos cuando algo falla. La base de datos llegará cuando haya preguntas de verdad ("cómo fue mi afinación en el la de la cuerda re este mes"), y eso vive en `practice.db`, aparte, porque es otra clase de dato: no una obra, sino tu historial.

**Por qué `vendor/` está versionado.** Las librerías del navegador (OSMD, 1,2 MB; el reproductor de soundfont, 23 KB; las muestras de violín, 2,8 MB) están guardadas dentro del repo en vez de cargarse desde un CDN. El motivo es de uso, no técnico: vas a tocar el violín con el portátil delante, y a veces sin wifi. El precio es que actualizar una librería es descargarla a mano.

---

## 2. Por qué este stack

| Pieza | Por qué esta y no otra |
|---|---|
| **uv** | Fija el árbol entero de dependencias en `uv.lock` y también la versión de Python, así que el proyecto se reconstruye idéntico dentro de un año. `pip` sin lock deja la reproducibilidad al azar. |
| **music21** (MIT, MIT) | Parsear MusicXML a mano es un proyecto en sí mismo: compases, alteraciones, ligaduras, anacrusas, repeticiones. music21 ya lo hace, da los tiempos en negras y conoce `MetronomeMark` y `TimeSignature`. Es una librería de musicología, no de audio: encaja porque lo que necesitamos es leer notación, no sonido. |
| **FastAPI + Pydantic** | El contrato se valida **al salir**, no por confianza. Si el motor escribiera un `timeline.json` fuera de forma, la API devuelve un 500 en vez de mandarle basura al visor. Además es lo que se pide en las ofertas de trabajo, y aquí se usa de verdad, no de adorno. |
| **OSMD** | Dibujar notación musical con las reglas del grabado (espaciado, agrupación de corcheas, alteraciones de cortesía) es un trabajo de años que no aporta nada a lo que Atril quiere resolver. Se delega, envuelto para poder cambiarlo. |
| **Sin bundler, scripts clásicos** | El visor son cuatro ficheros. Meter npm y un paso de build para eso añade una herramienta que mantener y una carpeta `node_modules` a un proyecto que por lo demás es Python puro. El precio: los ficheros se comunican por variables globales, no por `import`. Cuando el visor crezca, ese es el primer sitio a revisar. |
| **Web Audio a pelo** | Existen librerías de reproducción de partituras, pero todas quieren ser dueñas del reloj. El reloj tiene que ser nuestro, porque mañana el escucha tendrá que alinear lo que tocas con ese mismo reloj. Web Audio programa sonidos en una línea de tiempo que nosotros anclamos a la nuestra. |

---

## 3. La arquitectura del motor

`engine/build.py` son tres funciones puras y un `main()` que las conecta con la línea de comandos. Ninguna de ellas sabe que existe un visor.

**`_resolver_tempo(partitura, bpm) → (bpm, procedencia)`**
Implementa una cadena de precedencia explícita: lo que pasas por `--bpm` manda; si no, la marca de metrónomo del MusicXML; si no, 100 por defecto **avisando por consola**. Devuelve siempre también de dónde salió el número, y ese dato viaja al JSON como `tempo_source`. Está separada del resto porque es la única decisión del motor que puede estar equivocada sin que se note: un timeline con el tempo mal calculado parece perfectamente correcto.

**`_eventos_de(parte, segundos_por_negra) → lista de eventos`**
Recorre `parte.flatten().notesAndRests`. `flatten()` aplasta la jerarquía (partitura → compases → notas) en una secuencia plana, y cada elemento conserva su `offset`: su posición en negras desde el principio. La conversión a segundos es una multiplicación, y aquí está el único sitio donde el motor decide cómo se representa una nota: silencio → lista vacía, nota → lista de una, acorde → lista de varias, ordenadas de grave a aguda.

**`build_timeline(ruta, piece, bpm=None) → dict`**
Orquesta: parsea, resuelve tempo, saca el compás del primer `TimeSignature`, y construye un evento por elemento de **cada** parte. No elige parte: emite todas, porque quién toca cuál se decide al practicar, no al construir.

**`main()`**
Solo argparse, escritura del fichero y un resumen por consola. Toda la lógica está en las funciones de arriba, y por eso los tests las llaman directamente sin lanzar procesos.

### El examen del motor

`tests/test_build.py` tiene tres pruebas, y la primera es la que sostiene todo: compara la salida del motor con `data/pieces/escala-sol/timeline.json`, un fichero **escrito a mano antes de que el motor existiera**. Esa inversión (el resultado esperado primero, el código después) es lo que hace que el test signifique algo: no comprueba que el motor hace lo que hace, comprueba que hace lo que decidimos que tenía que hacer.

Las otras dos cubren las dos decisiones que más fácil se rompen sin enterarse: que `--bpm` gana sobre el fichero, y que un acorde de una pieza real produce un evento con varias notas ordenadas.

---

## 4. Las fronteras y lo que guarda cada una

Este proyecto no tiene decoradores de autorización ni middlewares, porque todavía no hay usuarios ni permisos. Lo que sí tiene son cuatro puntos donde algo puede entrar mal, y cada uno tiene su defensa:

**1. La salida del motor → `Timeline` de Pydantic.** En `server/app.py`, el endpoint declara `-> Timeline`. Si el JSON no cumple el contrato (falta `beats_per_measure`, `pitch` viene como texto en vez de lista, `tempo_source` trae un valor inventado), FastAPI devuelve un error del servidor en lugar de pasarlo. Ya nos salvó una vez en esta misma construcción: al cambiar `pitch` a lista, el servidor viejo cantó el fallo con la línea exacta.

**2. El nombre de la pieza que viene de la URL → `carpeta_de()`.** Es la única entrada del sistema que controla un desconocido. Resuelve la ruta y comprueba que el resultado cuelga literalmente de `data/pieces/`, así que `../../etc/passwd` no llega a ningún sitio. Sin esa comprobación, un parámetro de URL sería una lectura de ficheros arbitraria.

**3. El arranque del audio → `try/catch` en `tocar()`.** El navegador puede negarse a crear un `AudioContext`. Si eso pasa, se avisa y **la pieza sigue corriendo en silencio**: el cursor no depende del altavoz.

**4. El tiempo → un solo reloj.** `performance.now()` en `app.js` es la única fuente de "qué segundo es". El cursor y el audio no llevan cada uno su cuenta: los dos preguntan. Por eso no pueden desincronizarse entre ellos, solo respecto al reloj, y todos a la vez.

### Quién puede importar a quién

- `engine/` no importa nada de `server/` ni sabe que el visor existe.
- `server/` no importa `engine/`: solo lee ficheros de `data/`. Puedes borrar el motor y el servidor sigue sirviendo lo ya generado.
- `app.js` conoce a `ScoreView` y a `Sonido`. Ninguno de los dos conoce al otro, y ninguno conoce el `timeline.json`: reciben tiempos musicales, frecuencias e instantes.
- Solo `score-view.js` nombra `opensheetmusicdisplay`. Solo `audio.js` nombra `AudioContext`.

Esa última regla es la que hace que cambiar de librería de dibujo o de motor de sonido sea reescribir un fichero, y no una tarde de arqueología.

---

## 5. El recorrido completo, paso a paso

### Fase 1 · Preparar la pieza (una vez)

```bash
uv run python -m engine.build data/pieces/mozart-k155/score.musicxml \
  --piece mozart-k155 --bpm 120
```

1. `uv run` activa el entorno del `uv.lock`: Python 3.13 con music21 y nada más que no esté fijado.
2. `argparse` lee la ruta, `--piece` y `--bpm`.
3. `converter.parse()` de music21 convierte el XML en un objeto `Score`: partes → compases → notas, cada una con su `offset` en negras.
4. `_resolver_tempo` ve que hay `--bpm` y devuelve `(120, "cli")`. Si no lo hubieras pasado, buscaría el `MetronomeMark`; si tampoco, asumiría 100 y te avisaría.
5. `60 / 120 = 0,5` segundos por negra. Este número convierte toda la partitura de música a tiempo.
6. Se recorre cada parte. Por cada nota, silencio o acorde sale un evento con su índice, sus alturas, sus frecuencias, su inicio y duración en segundos, y su compás y tiempo.
7. Se escribe `data/pieces/mozart-k155/timeline.json` y se imprime el resumen: `Violin I (876 eventos), Violin II (742)…`.

A partir de aquí el motor ya no pinta nada. La pieza está preparada.

### Fase 2 · Practicar (cada sesión)

```bash
uv run uvicorn server.app:app --port 8000
```

1. **`GET /`** → lo sirve `StaticFiles`, que está montado en la raíz y devuelve `viewer/index.html`.
2. El HTML carga los scripts **en este orden y no en otro**: OSMD, el reproductor de soundfont, `score-view.js`, `audio.js`, `app.js`. Cada uno define un nombre global que el siguiente necesita; `app.js` va el último porque los usa a todos.
3. `app.js` ejecuta `iniciar()`: **`GET /api/pieces/mozart-k155/timeline`**.
4. En el servidor: `carpeta_de()` comprueba que la pieza existe y está donde debe → se lee el JSON → se construye `Timeline(**datos)`, que valida cada campo de cada evento → se serializa de vuelta.
5. `app.js` guarda el `bpm`, se queda con la primera voz, rellena el selector con todas, y escribe la cabecera.
6. Crea el `ScoreView`, que llama a `osmd.load()` con **`GET /api/pieces/mozart-k155/score.musicxml`** y dibuja la partitura. El visor pide el mismo fichero que comió el motor, pero para otra cosa: el motor sacó tiempos, OSMD saca dibujo.
7. Pulsas **Tocar**:
   - Si hay audio activado, `sonido.despertar()` crea el `AudioContext` (el navegador solo lo permite tras un gesto tuyo) y `anclar()` apunta qué instante del reloj de audio corresponde al segundo cero de la pieza.
   - `reengancharAudio()` calcula por qué clic de metrónomo y por qué evento hay que seguir, para que puedas darle a Tocar a mitad de la pieza.
   - Se guarda `performance.now()` como origen y se pide el primer fotograma.
8. En cada fotograma, `tick()` hace siempre lo mismo, en este orden:
   - **Qué segundo es**: `segundosAhora()`.
   - **Dónde está el cursor**: `situarPuntero()` avanza (o retrocede) el índice mientras el evento siguiente ya haya empezado, y le pide a `ScoreView` que ponga el cursor en ese **tiempo musical**, no en ese índice. La diferencia importa: el cursor de OSMD recorre la partitura entera, y con cuatro voces el índice de tu voz y sus pasos no coinciden.
   - **Qué va a sonar**: `programarAudio()` mira los próximos 300 ms y le entrega a Web Audio los clics de metrónomo y las notas que empiezan en esa ventana, con su instante exacto. Se programa por delante porque JavaScript no es puntual y Web Audio sí.
   - **Qué se lee en pantalla**: `pintarEstado()`.
   - Si se acabó la pieza, para; si no, pide el siguiente fotograma.
9. Cambias de voz en el selector: se cambia la lista de eventos, se recoloca el puntero y el audio en el mismo segundo, y sigue.

### Lo que aún no hace

Nada de esto escucha todavía. El siguiente escalón es el escucha (micrófono → `note_events.json`) y el corrector, que comparará ese fichero con el `timeline.json` de la voz que estabas siguiendo. La forma de esa comparación ya está preparada: los dos ficheros hablan en segundos y en hercios.
