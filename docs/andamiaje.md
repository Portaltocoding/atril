# Andamiaje de Atril

Plan de obra del primer escalón, en versión larga: cada decisión explicada hasta el fondo, cada término definido la primera vez que aparece, y un deep dive de arquitectura antes de tocar nada. Al acabar el andamiaje, una partitura digital se recorre sola en pantalla, al tempo.

- Diseño completo del sistema: https://claude.ai/code/artifact/7244a4ad-a990-4360-bf36-f9fd37ae699f
- Versión artifact de este documento: https://claude.ai/code/artifact/c0caebca-b452-43a3-a145-52636fe88cec
- Camino de ML del Listener (documento aparte): [listener-ml.md](listener-ml.md)

## Cómo leer esto

Primero va el **deep dive de arquitectura**: las reglas del sistema entero, por qué existen, y la lista de cosas que lo pudrirían. Es la sección que hay que poder recitar de memoria dentro de seis meses; todo lo demás son consecuencias de ella.

Después, el plan en **bloques por tipo de trabajo** (infraestructura, contrato de datos, Python, web, verificación), y cada bloque con el mismo ritmo, de menos a más: una línea con lo que queda hecho, el cómo en detalle técnico, el ELI5, el porqué de la decisión y de su posición en el orden, la comprobación que cierra el bloque, y lo que queda abierto para discutir.

Regla de este documento: si un párrafo usa una palabra que no se ha definido antes, es un bug del documento.

---

## Deep dive 1: por qué se pudren las arquitecturas

Un proyecto no muere porque una pieza esté mal escrita: muere por **acoplamiento**. Acoplamiento es que una pieza sepa cosas de otra que no le hacen falta: el visor que conoce el formato interno del motor, el motor que sabe cómo pinta el visor, la función que solo funciona si otra se llamó antes. Cada uno de esos hilos invisibles es barato el día que se crea y carísimo después, porque el coste no es escribirlo: es que *cambiar cualquier cosa obliga a tocar tres*, y llega un día en que ya no sabes qué se rompe si tocas qué. Ese día el proyecto deja de ser tuyo.

El síntoma temprano es siempre el mismo: para explicar cómo funciona una pieza necesitas explicar otra. El síntoma tardío: te da miedo tocar tu propio código. La arquitectura de Atril está diseñada entera alrededor de impedir eso, con una sola idea repetida en cada frontera.

### La idea única: toda frontera es un fichero que puedes leer

En Atril, dos piezas nunca se hablan directamente: una escribe un fichero JSON en disco, la otra lo lee. `timeline.json` entre engine y viewer; `note_events.json` entre Listener y Corrector; `interpretation.json` entre el LLM y el resto. Esto compra cinco propiedades a la vez:

- **Puedes depurar con los ojos.** Si el cursor se mueve mal, abres `timeline.json`. ¿Los números están mal? El bug es del engine. ¿Están bien? El bug es del viewer. Una frontera legible parte cada problema en dos mitades, como una búsqueda binaria sobre tu propio sistema.
- **Puedes falsificar cualquier pieza.** Un fichero escrito a mano sustituye a un componente entero. Así se construye el viewer antes de que exista el engine (bloque 1), y así probarás el Corrector con un `note_events.json` inventado antes de tener ningún modelo.
- **Puedes reemplazar sin permiso.** Mientras el fichero tenga el mismo formato, da igual qué lo generó: pYIN, CREPE o tu red. Nadie más se entera del cambio.
- **Puedes cachear gratis.** Un fichero en disco ya es una caché; el hash del fichero de entrada es la llave. Por eso la llamada al LLM (MVP) cuesta una vez por pieza y no una por sesión.
- **Puedes cambiar de forma sin reescribir.** Programa local, app de escritorio o web app son la misma pregunta: ¿quién le acerca los ficheros al viewer? Un script, Tauri o un servidor. El código no cambia, cambia el cartero.

El precio de esta idea es la disciplina: la tentación constante de "pasarle el objeto directamente, total, están en el mismo proyecto". Cada vez que se cede a esa tentación, una de las cinco propiedades muere en esa frontera.

> **ELI5:** dos cocineros pueden trabajar hombro con hombro pasándose cosas de la mano (rápido hoy, caos mañana: nadie sabe ya quién echó la sal), o pueden trabajar con una ventanilla entre medias por la que pasan platos etiquetados. Con ventanilla puedes mirar cada plato, sustituir a un cocinero sin avisar al otro, y hasta poner un plato de plástico para ensayar. Atril es todo ventanillas.

## Deep dive 2: las tres fases temporales

Además de *quién habla con quién*, la arquitectura separa *cuándo pasa cada cosa*. Todo el sistema se reparte en tres momentos, y la regla es que el trabajo caro, lento o no determinista solo puede vivir en el primero:

| Fase | Cuándo ocurre | Qué vive ahí | Qué se le permite |
|---|---|---|---|
| Preparación | una vez por pieza | engine: parseo, OMR (MVP), llamada al LLM (MVP) | ser lenta, llamar a la red, fallar y reintentar; su salida se cachea en disco |
| Ejecución | cada sesión de práctica | viewer, y en el MVP: Listener y Corrector | nada de red, nada de LLM, determinista: mismos ficheros, mismo resultado |
| Acumulación | entre sesiones | practice.db (MVP), heatmap, agent profesor (add-ons) | leer la historia, nunca tocar la ejecución en vivo |

**Por qué esta separación importa tanto:** un LLM tarda segundos y a veces responde distinto; un cursor que sigue música necesita responder en milisegundos y siempre igual. Si mezclas ambos mundos, heredas lo peor de cada uno: una app lenta y además impredecible. Separándolos, el LLM puede ser todo lo listo y lento que quiera (nadie lo espera en vivo) y la ejecución puede ser tonta y rapidísima (todo su trabajo ya está precalculado en un JSON). El "determinista" de la fase de ejecución es también lo que la hace testeable: puedes escribir un test contra ella porque siempre responde lo mismo.

> **ELI5:** un restaurante no inventa el menú cuando el cliente ya está sentado. El menú se piensa por la mañana con calma (preparación), el servicio ejecuta sin pensar (ejecución), y el libro de reservas cuenta qué gustó para ajustar el menú de mañana (acumulación). Si el chef se pone a filosofar durante el servicio, los platos salen fríos.

## Deep dive 3: el mapa de qué-pasa-si

La prueba de fuego de una arquitectura no es el diagrama: es responder "¿qué tengo que tocar si cambio X?" sin abrir el código. Estas son las respuestas que el diseño garantiza:

| Si mañana… | Se toca | No se toca |
|---|---|---|
| OSMD no sirve y cambias de visor | solo `score-view.js` | engine, timeline.json, app.js (habla con el wrapper, no con OSMD) |
| cambias pYIN por CREPE o por tu red | solo la carpeta `listener/` | todo lo demás: el contrato `note_events.json` no se mueve |
| el cursor pasa de BPM constante a curva expresiva | solo el engine (escribe otros `start_s`) | el viewer: ya solo lee segundos, le da igual de dónde salgan |
| pasas de programa local a web app | quién sirve los ficheros (un FastAPI delante) | engine y viewer enteros |
| una partitura viene en PDF | se añade un paso antes del engine (OMR) | todo lo posterior: el pipeline arranca igual desde MusicXML |
| quieres soporte de viola | parámetros (afinación de cuerdas, largo de cuerda) | la estructura: nada asume violín salvo constantes |

Fíjate en el patrón: **cada cambio razonable toca exactamente una casilla**. Cuando en el futuro una feature nueva te obligue a tocar dos o más casillas a la vez, esa es la alarma: o la feature está mal planteada, o está naciendo un acoplamiento. Ese es el momento de parar y discutir, no después de implementarla.

## Deep dive 4: reglas de dependencia y dónde vive el estado

### Quién puede importar a quién

"Importar" es la forma técnica del acoplamiento: si el fichero A hace `import B`, A depende de B para siempre. Las reglas de Atril caben en cuatro líneas:

- **engine y viewer no se importan jamás.** Ni siquiera comparten lenguaje (Python vs JavaScript), y eso es a propósito: hace el acoplamiento accidental físicamente imposible. Su único canal son los dos ficheros.
- **Solo `score-view.js` importa OSMD.** Si mañana aparece `opensheetmusicdisplay` en cualquier otro fichero, es una regresión, aunque funcione.
- **El listener no importa nada del resto** (y viceversa). Entra audio, sale JSON.
- **Nadie importa "hacia arriba".** El engine no sabe que existe un viewer; el Listener no sabe que existe un Corrector. Cada pieza escribe su fichero y se va a dormir.

La vigilancia no necesita herramientas: `grep -r "opensheetmusicdisplay" viewer/` debe devolver un solo fichero. Un grep por regla, de pascuas a ramos. Cuando el proyecto crezca, esto se puede automatizar en CI; hoy sería burocracia.

### Dónde vive el estado

"Estado" es todo dato que sobrevive entre dos momentos: si se pierde, algo se olvida. La regla de Atril: **el estado duradero vive en disco, con nombre y formato conocidos; la memoria de los programas solo guarda estado efímero**. En el andamiaje el inventario completo es diminuto:

- **En disco:** las carpetas `data/pieces/<pieza>/` con sus ficheros. Es todo el estado del sistema. Borras la carpeta, la pieza no existe; la copias a otro ordenador, la pieza viaja entera.
- **En memoria del viewer, mientras la pestaña está abierta:** el reloj (cuánto tiempo llevamos reproduciendo) y el puntero (por qué evento vamos). Cerrar la pestaña los destruye y no se pierde nada importante.
- **En ningún sitio:** no hay sesiones, ni usuario, ni configuración, ni base de datos. `practice.db` nace en el MVP porque el Corrector produce resultados que sí duele perder; hoy no existe nada así.

## Deep dive 5: los anti-patrones

La lista negra concreta. Ninguno parece grave el día que se comete; todos parecen "una excepción razonable". Así es exactamente como los proyectos que crecen más rápido de lo que se entienden acaban siendo de nadie:

1. **El viewer parsea MusicXML para calcular algo.** En ese momento hay dos piezas que entienden teoría musical, y toda corrección futura hay que hacerla dos veces. Todo lo que el viewer necesite saber debe llegar por `timeline.json`; si no llega, se amplía el timeline, no el viewer.
2. **El engine sabe algo de píxeles, SVG u OSMD.** El engine trabaja en el mundo de la música (notas, compases, segundos); el día que sepa de pantalla, cambiar de visor exigirá tocar el motor.
3. **Pasar objetos vivos en vez de ficheros** "por rendimiento". El rendimiento sobra (son kilobytes), y se pierden las cinco propiedades de la ventanilla. Si un día hay un cuello de botella real, se mide primero y se discute después.
4. **Llamar al LLM (o a cualquier red) durante la ejecución.** Rompe la separación de fases: la app se vuelve lenta, cara e impredecible de golpe. Todo lo que el LLM aporte se precalcula y se cachea.
5. **El campo fantasma:** añadir campos al JSON "por si acaso" que nadie lee aún. Cada campo del contrato es una promesa de mantenimiento eterno; se añade cuando hay un lector, no antes. (Los `string`/`finger` a `null` del andamiaje rozan esta línea: se admiten porque su lector, el Corrector, ya está diseñado y llega en el MVP.)
6. **"Ya lo refactorizo luego" aplicado a una frontera.** En el interior de una pieza, deuda técnica es deuda normal: se paga cuando toque y no se propaga. En una frontera, la deuda es contagiosa: todos los que leen ese fichero heredan el apaño. Interior sucio, fronteras impecables; nunca al revés.

> **ELI5:** todas son variantes del mismo pecado: abrir un agujero en la pared porque la puerta pilla lejos. El primer agujero ahorra diez pasos. Al año, la casa es un queso gruyer, no sabes qué pared aguanta el techo, y ya no puedes tirar ninguna.

### El método anti caja negra

Una regla de trabajo, no de código: **no se ejecuta un bloque cuyo cómo y porqué no puedas explicar tú, con la pantalla apagada**. El documento se amplía antes de que el código exista, no después. Y cada fase futura (MVP, add-ons) repite el ciclo: deep dive por escrito, discusión, y solo entonces código. La medida del éxito no es que Atril funcione: es que dentro de seis meses puedas dibujar este sistema en una servilleta y defender cada flecha.

---

## Cinco bloques y su orden

| Bloque | Tipo | Qué queda al acabar | Depende de |
|---|---|---|---|
| 0 · Repo | infraestructura | carpeta versionada donde trabajar | nada |
| 1 · Contrato | datos | un timeline.json escrito a mano | 0 |
| 2 · Engine | Python | partitura real convertida a timeline.json | 1 |
| 3 · Viewer | web | partitura en pantalla con cursor y play/pause | 1 (no del 2) |
| 4 · Integración | verificación | pieza real recorriéndose sola, riesgo OSMD validado | 2 y 3 |

La clave del orden: el contrato (bloque 1) va antes que el engine y el viewer precisamente para que esos dos no dependan entre sí. Con un timeline.json escrito a mano, el viewer se construye y se prueba sin que exista ni una línea de Python.

---

## Bloque 0 · Repo y estructura (tipo: infraestructura)

**Al acabar:** un repo git con la estructura de carpetas del diseño y el entorno Python listo.

### Cómo lo haría, paso a paso

Crear `~/workspace/atril`, `git init` dentro, y la estructura mínima del diseño: `engine/`, `viewer/`, `data/pieces/`. La estructura de carpetas espeja los subproyectos del diseño a propósito: cuando el árbol de ficheros y el diagrama de arquitectura se parecen, el proyecto se explica solo al abrirlo.

**El entorno Python, con uv.** uv es un gestor de entornos y paquetes (de Astral, los de ruff). Hace lo mismo que `pip` + `venv` pero con dos ventajas que aquí importan: genera un `uv.lock` (la lista exacta de versiones instaladas, con lo que el entorno es reproducible en cualquier máquina: clave para un repo público) y su `uv run` ejecuta cualquier comando dentro del entorno sin tener que "activarlo" antes.

```bash
uv init --python 3.12    # crea pyproject.toml
uv add music21           # unica dependencia del andamiaje
```

**Qué es music21.** Un toolkit de musicología computacional del MIT: parsea MusicXML (entre otros formatos) y te da la partitura como objetos Python navegables: un `Score` contiene `Part`s (instrumentos), que contienen `Measure`s (compases), que contienen `Note`s. Nos ahorra escribir un parser de XML musical, que es un problema endiablado (el estándar tiene cientos de páginas).

**Qué es MusicXML.** El formato estándar de intercambio de partituras: un XML donde cada nota es un elemento con su altura y duración. Lo exportan e importan MuseScore, Finale, Sibelius y compañía. Una nota, por dentro:

```xml
<note>
  <pitch>
    <step>A</step>        <!-- la nota: La -->
    <octave>4</octave>    <!-- la octava: A4 = 440 Hz -->
  </pitch>
  <duration>2</duration>  <!-- en "divisions", la resolucion que declara el fichero -->
  <type>quarter</type>    <!-- negra -->
</note>
```

Detalle del `duration`: MusicXML no mide en segundos sino en "divisions", una unidad que cada fichero define al principio (por ejemplo "2 divisions = 1 negra"). Los segundos no existen en la partitura: los fabricará nuestro engine con el BPM. Esta distinción (partitura = tiempo musical, timeline = tiempo de reloj) es la esencia del bloque 2.

**Las partituras de prueba.** Dos, con papeles distintos. La *trivial*: una escala de Sol mayor de 8 negras, hecha por ti en MuseScore en dos minutos y exportada a MusicXML; sirve de fixture de test porque conoces la respuesta correcta de antemano. La *real*: la Gavotte de Gossec (del repertorio Suzuki, con silencios, ligaduras y notas rápidas), descargada de MuseScore.com en MusicXML; sirve de prueba de fuego porque tiene todo lo que la escala no tiene.

**Remates:** un README de tres párrafos (qué es Atril, en qué estado está, cómo ejecutarlo), un `.gitignore` de Python (el estándar de GitHub) y primer commit. Nada más: sin CI (servidores que ejecutan tus tests en cada push; burocracia sin tests que ejecutar), sin Docker (resuelve "en mi máquina funciona", un problema que un proyecto de una persona y una máquina no tiene), sin elegir licencia todavía (se decide al publicar en serio, final del bloque 4; MIT es la candidata por defecto).

> **ELI5:** antes de cocinar, despejas la mesa y sacas los cacharros. git es el cuaderno donde apuntas cada cambio para poder volver atrás; uv es el cajón etiquetado de utensilios (con la etiqueta `uv.lock` diciendo exactamente qué hay dentro, para que otro pueda montar el mismo cajón); las dos partituras son los ingredientes: uno de juguete para practicar el corte, uno de verdad para el plato final. Y no compras la batidora industrial (CI, Docker) porque todavía no hay nada que batir.

### Por qué así y por qué ahora

Va primero porque todo lo demás necesita un sitio donde vivir, y va así de pelado por una razón de fondo: **cada pieza de infraestructura es mantenimiento perpetuo**, y el mantenimiento se paga con la moneda más escasa del proyecto (tus tardes). La estrategia de Atril es open source en público, pero "en público" significa código visible, no parafernalia: el momento de pulir el repo para audiencia es cuando el cursor se mueva (final del bloque 4), porque un repo precioso sin nada funcionando es exactamente la señal contraria a la que quieres dar.

> **Comprobación:** `uv run python -c "import music21"` sale limpio, y las dos partituras abren en MuseScore sin errores (eso valida que el MusicXML descargado no está corrupto antes de culpar a nuestro código).

**Para discutir:** ¿repo público desde el día uno o privado hasta que el cursor se mueva? Mi propuesta: público desde el día uno, historia incluida; el "building in public" vale más con las costuras a la vista, y nadie mira el repo de un desconocido hasta que este lo enseña.

---

## Bloque 1 · El contrato: timeline.json a mano (tipo: contrato de datos)

**Al acabar:** un timeline.json de la escala de Sol, escrito a mano, que hace de contrato y de fixture de test.

### Cómo lo haría, paso a paso

Dos términos primero. Un **contrato de datos** es un acuerdo sobre la forma exacta de un fichero: qué campos tiene, de qué tipo es cada uno, quién lo escribe y quién lo lee. Un **fixture** es un dato de prueba fijo y conocido: como sabes de antemano la respuesta correcta, cualquier desviación es un bug seguro.

El trabajo: escribir a mano `data/pieces/escala-sol/timeline.json` con las 8 notas de la escala a negra = 80 (a 80 pulsos por minuto, cada negra dura 60/80 = 0.75 segundos, así que la nota n empieza en n × 0.75).

```json
{
  "piece": "escala-sol",
  "tempo_map": [ { "measure": 1, "bpm": 80 } ],
  "events": [
    { "index": 0, "pitch": "G4", "freq_hz": 392.0,
      "start_s": 0.0,  "duration_s": 0.75,
      "measure": 1, "beat": 1.0, "string": null, "finger": null },
    { "index": 1, "pitch": "A4", "freq_hz": 440.0,
      "start_s": 0.75, "duration_s": 0.75,
      "measure": 1, "beat": 2.0, "string": null, "finger": null }
  ]
}
```

El contrato campo a campo:

| Campo | Qué es | Quién lo lee y para qué |
|---|---|---|
| index | posición del evento, 0, 1, 2… | el viewer: "cursor a la nota 14" es este número; y el Corrector (MVP) para decir "fallaste la nota 14" |
| pitch | nota en notación científica ("A4": La de la octava 4) | humanos y mensajes de feedback; el reloj no lo usa |
| freq_hz | frecuencia de esa nota en hercios (A4 = 440.0) | el Corrector (MVP), que compara hercios contra hercios. Se precalcula aquí para que nadie más en el sistema sepa convertir notas a frecuencias: esa fórmula vive solo en el engine |
| start_s | instante en que empieza la nota, en segundos desde el inicio | el viewer: el reloj compara contra esto. Es EL campo del andamiaje |
| duration_s | cuánto dura, en segundos | el Corrector (MVP), para juzgar ritmo; el viewer no lo necesita (la nota "acaba" cuando empieza la siguiente) |
| measure, beat | compás y pulso dentro del compás | mensajes humanos ("compás 12, tercer pulso"); jamás para calcular tiempo, para eso está start_s |
| string, finger | cuerda y dedo con que se toca | `null` en el andamiaje; los rellenará el intérprete LLM (MVP) y los usará el Corrector para el feedback en milímetros |
| tempo_map | lista de (compás, BPM) | solo para mostrar ("negra = 80") en la interfaz; los cálculos ya están hechos en los start_s. Redundante a propósito |

**La decisión de diseño escondida aquí:** el timeline habla en *segundos*, no en compases ni pulsos. ¿Por qué? Porque el consumidor es un reloj de navegador, y los relojes miden segundos. Toda la teoría musical necesaria para convertir "negra con puntillo en un 6/8 a 92 BPM" en "0.978 segundos" queda encerrada en el engine; el viewer y el futuro Corrector viven en la ignorancia musical más absoluta, y esa ignorancia es lo que los hace simples. Si un día el timeline hablara en pulsos, cada consumidor necesitaría saber convertir pulsos a segundos, y la teoría musical se habría desparramado por todo el sistema (anti-patrón 1 del deep dive).

> **ELI5:** es acordar la forma del enchufe antes de fabricar la lámpara y la pared. Si los dos respetan la forma, cada uno se construye por su lado y encajan a la primera. El fichero a mano es el enchufe de mentira para probar la lámpara antes de que la pared exista.
>
> Y lo de los segundos: la partitura habla "idioma músico" (compases, negras) y el reloj habla "idioma cronómetro" (segundos). El engine es el único traductor autorizado; todos los demás solo entienden cronómetro. Un solo traductor = una sola pieza que corregir si la traducción falla.

### Por qué así y por qué ahora

Este bloque es media hora de trabajo y es el que compra la independencia de los otros dos: con el fixture a mano, el viewer (bloque 3) no espera al engine (bloque 2), y el test del engine tiene una salida esperada contra la que comparar. Es la primera vez que se ejerce, en pequeño, la idea única del deep dive: la frontera es un fichero, y un fichero se puede falsificar. La misma jugada se repetirá con `note_events.json` cuando arranque el Listener.

> **Comprobación:** `python -m json.tool` lo traga (JSON sintácticamente válido), y los `start_s` cuadran a mano: nota n empieza en n × 0.75.

**Para discutir:** ¿los silencios entran en `events`? El diseño dice solo notas y propongo mantenerlo (el Listener compara notas, no silencios); el roce que esto crea con el cursor de OSMD se resuelve en el viewer, ver bloque 3.

---

## Bloque 2 · Engine: de MusicXML a timeline.json (tipo: Python)

**Al acabar:** `uv run python -m engine.build data/pieces/gavotte-gossec` genera el timeline.json real.

### Cómo lo haría, paso a paso

Un solo módulo, `engine/build.py`, en torno a las 80 líneas. Las cuatro piezas de music21 que hay que entender, porque el módulo entero es solo pegarlas:

- **`converter.parse(ruta)`** lee el MusicXML y devuelve un `Score`: el árbol Score → Part → Measure → Note.
- **`.flatten()`** aplana ese árbol: quita los compases como contenedores y deja las notas en una lista plana donde cada una lleva su `offset` *absoluto* (su posición desde el inicio de la obra, medida en negras). Sin flatten, el offset de cada nota es relativo a su compás y tendrías que ir sumando compases a mano.
- **`offset` y `quarterLength`** son la posición y la duración *en unidades de negra* (quarterLength 1.0 = negra, 0.5 = corchea, 1.5 = negra con puntillo). Tiempo musical, no segundos. Ojo: pueden ser `Fraction` (un tercio de negra en un tresillo), por eso el código los envuelve en `float()`.
- **`MetronomeMark`** es la indicación de metrónomo escrita en la partitura ("negra = 92"). Si la partitura la trae, se respeta; si no, 80 BPM por defecto, un tempo de estudio razonable.

La conversión entera entre los dos mundos es una multiplicación: `segundos = negras × (60 / bpm)`. El corazón del módulo:

```python
from music21 import converter

def build(piece_dir: Path) -> dict:
    score = converter.parse(piece_dir / "score.musicxml")
    part = score.parts[0].flatten()
    mm = part.getElementsByClass("MetronomeMark").first()
    bpm = mm.number if mm and mm.number else 80
    spq = 60.0 / bpm                      # segundos por negra ("seconds per quarter")
    events = []
    for i, n in enumerate(part.notes):    # .notes = notas y acordes, sin silencios
        if n.isChord:
            n = n.notes[-1]               # ponytail: doble cuerda -> nota aguda; acordes reales, en el MVP
        events.append({
            "index": i,
            "pitch": n.pitch.nameWithOctave,
            "freq_hz": round(n.pitch.frequency, 2),
            "start_s": round(float(n.offset) * spq, 3),
            "duration_s": round(float(n.duration.quarterLength) * spq, 3),
            "measure": n.measureNumber,
            "beat": float(n.beat),
            "string": None, "finger": None,
        })
    return {"piece": piece_dir.name,
            "tempo_map": [{"measure": 1, "bpm": bpm}],
            "events": events}
```

Detalles del código que no son casuales:

- `score.parts[0]`: la primera parte, porque una partitura de violín solo tiene una. Cuando exista acompañamiento de piano, elegir parte será un parámetro; hoy sería el campo fantasma del deep dive.
- `part.notes` excluye los silencios a propósito (decisión del bloque 1: el contrato lleva solo notas).
- `round(…, 3)`: redondeo a milisegundos. Más precisión es mentira útil para nadie (el frame de pantalla dura 16 ms) y hace los diffs de git ilegibles.
- `n.isChord`: en violín, dos cuerdas a la vez (doble cuerda). Quedarse con la aguda es la simplificación honesta del andamiaje, marcada con un comentario `ponytail:` que dice cuál es el techo y cuándo subirlo.

**El test, y el ritual completo de TDD.** TDD (test-driven development) en versión ligera: se escribe primero `tests/test_build.py` contra la escala de Sol del bloque 1, con afirmaciones que conocemos de antemano porque el fixture es nuestro: 8 eventos, `start_s` de la primera nota 0.0 y de la última 5.25, `freq_hz` del La 440.0. Se ejecuta *antes de implementar* y se mira fallar: ese fallo es la prueba de que el test de verdad prueba algo (un test que nunca ha fallado podría estar pasando por accidente). Luego se implementa, pasa, y commit. Un test, no una suite: el resto de casos raros (ligaduras, tresillos) los cazará la Gavotte en el bloque 4, y escribir tests para casos que aún no existen es especular.

> **ELI5:** la partitura es un dibujo; el engine lo convierte en una lista de instrucciones con cronómetro: "en el segundo 0, Sol; en el 0.75, La". El dibujo lo entiende un músico; la lista la entiende cualquier programa que sepa mirar un reloj.
>
> Y el ritual del test: antes de encargar la tarta, le enseñas al pastelero una foto de la tarta que quieres (el test con el fixture). Primero compruebas que el pastelero, sin receta, NO sabe hacerla (el test falla): así sabes que la foto exige algo de verdad. Cuando la tarta sale igual que la foto, has terminado, y la foto se queda colgada en la pared vigilando para siempre.

### Por qué así y por qué ahora

Es la mitad que produce datos reales y la más barata de verificar: entra un fichero, sale otro, sin navegador de por medio, y con un fixture cuyo resultado correcto conocemos al dígito. BPM constante porque la curva de tempo expresivo (ritardandos, rubato) es exactamente el trabajo del intérprete LLM, que es MVP: meterlo ahora sería adelantar la pieza más cara del sistema para un cursor que aún no existe. La digitación igual: `null` hoy, LLM mañana, y el contrato no cambia. Ambas mejoras futuras caen en la casilla "solo se toca el engine" del mapa de qué-pasa-si: eso es lo que compramos con el timeline en segundos.

> **Comprobación:** `pytest` en verde, y el timeline.json de la Gavotte termina en un `start_s` que cuadra con la duración real de la pieza a ese BPM (cuenta de servilleta: compases × pulsos × 60/bpm).

**Para discutir:** las notas ligadas (tie: dos figuras unidas que suenan como una sola nota larga) salen hoy como dos eventos separados. Propongo dejarlo así en el andamiaje: music21 puede fusionarlas (`stripTies()`), pero eso rompería la correspondencia uno-a-uno con los pasos del cursor de OSMD, y para mover un cursor da exactamente igual. Importará cuando el Corrector compare duraciones (una ligadura mal fusionada acusaría de "nota corta" a una nota perfecta), y ahí se decide con el problema delante.

---

## Bloque 3 · Viewer: OSMD envuelto, reloj y cursor (tipo: web)

**Al acabar:** la escala de Sol (fixture a mano) se ve en el navegador y el cursor la recorre con play/pause.

### Cómo lo haría, paso a paso

Tres ficheros y ninguna herramienta de build: `viewer/index.html`, `viewer/score-view.js` y `viewer/app.js`. El vocabulario de esta pieza:

- **OSMD** (OpenSheetMusicDisplay): librería open source que renderiza MusicXML a SVG en el navegador (el grabado de las notas lo hace VexFlow por debajo). Trae de serie justo lo que necesitamos: un cursor que avanza nota a nota y la opción `followCursor` para que la partitura haga scroll sola siguiéndolo.
- **Build UMD**: una librería JS puede empaquetarse de varias formas; la UMD (Universal Module Definition) es la que, cargada con una etiqueta `<script src="…">`, deja una variable global (`opensheetmusicdisplay`) disponible para tu código. Es el formato "sin herramientas": no exige npm ni bundler.
- **CDN** (content delivery network): servidor público que sirve librerías por URL. Usaremos jsDelivr con la versión clavada en la URL (`opensheetmusicdisplay@1.8.4`): clavar la versión evita que una actualización ajena te rompa el viewer un martes cualquiera.
- **Por qué hace falta un servidor local:** si abres `index.html` con doble clic (protocolo `file://`), el navegador bloquea los `fetch` de ficheros vecinos por su política de seguridad de orígenes (un "origen" es la identidad protocolo+dominio+puerto de una página; `file://` es un origen sin permisos). `python -m http.server` convierte la carpeta en un origen HTTP normal (`http://localhost:8000`) y todo funciona. Es un comando, no infraestructura.

**score-view.js: el wrapper.** Un wrapper (o adapter) es una pieza que envuelve a una librería ajena y le pone la cara que tu programa quiere ver. La regla sagrada del diseño: solo este fichero conoce OSMD.

```js
// score-view.js: lo unico que sabe de OSMD en todo Atril
class ScoreView {
  constructor(container) {
    this.osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(
      container, { followCursor: true });
    this.index = -1;
  }
  async load(xmlText) {
    await this.osmd.load(xmlText);
    this.osmd.render();
    this.osmd.cursor.show();
    this.index = 0;
  }
  seekTo(i) {            // solo hacia delante; volver atras = reset()
    while (this.index < i) {
      this.osmd.cursor.next();
      while (this._enSilencio()) this.osmd.cursor.next();
      this.index++;
    }
  }
  reset() { this.osmd.cursor.reset(); this.index = 0; }
  _enSilencio() {        // el timeline no trae silencios; el cursor si los pisa
    const notas = this.osmd.cursor.NotesUnderCursor();
    return notas.length > 0 && notas.every(n => n.isRest());
  }
}
```

La pieza delicada es `_enSilencio()`: el cursor de OSMD recorre *todo* lo escrito, silencios incluidos, pero nuestro timeline solo numera notas (decisión del bloque 1). Este método reconcilia ambos mundos saltando los silencios al vuelo, de modo que "evento 14 del timeline" y "posición 14 del cursor" signifiquen la misma nota. Toda la fricción de esa decisión de contrato queda pagada aquí, en cuatro líneas y en un solo fichero: exactamente donde el deep dive dice que debe pagarse.

**app.js: el reloj y el puntero.** Dos conceptos de navegador:

- **`requestAnimationFrame`** (rAF): le pides al navegador "llama a esta función justo antes de pintar el próximo frame", unas 60 veces por segundo. Es la forma correcta de animar: la alternativa, `setInterval`, no está sincronizada con el repintado y deriva.
- **`performance.now()`**: cronómetro en milisegundos, monotónico (solo avanza; `Date.now()` puede pegar saltos si el sistema ajusta la hora). Para medir "cuánto tiempo llevo reproduciendo", monotónico es lo que quieres.

El reloj con pausa es un pequeño acumulador, y es todo el estado del viewer:

```js
// app.js (nucleo). Un reloj pausable y un puntero que avanza.
const clock = {
  elapsed: 0, startedAt: null,          // ms acumulados + marca del ultimo play
  play()  { this.startedAt = performance.now(); },
  pause() { this.elapsed += performance.now() - this.startedAt;
            this.startedAt = null; },
  now()   { return (this.elapsed + (this.startedAt
              ? performance.now() - this.startedAt : 0)) / 1000; }  // en segundos
};

let k = 0;                              // puntero: ultimo evento alcanzado
function tick() {
  const t = clock.now();
  while (k + 1 < events.length && events[k + 1].start_s <= t) k++;
  view.seekTo(k);
  if (reproduciendo) requestAnimationFrame(tick);
}
```

El puntero merece una explicación honesta porque el diseño decía "búsqueda binaria" y esto no lo es. Búsqueda binaria: encontrar un valor en una lista ordenada partiéndola por la mitad cada vez (log₂ de n pasos). El puntero: como el reloj solo avanza, el próximo evento está casi siempre a un paso del actual, así que basta avanzar mientras toque. Menos código, y el mismo resultado *mientras la reproducción sea monótona*. El día que exista "saltar al compás 24" (un salto arbitrario en el tiempo), la búsqueda binaria vuelve a ser la herramienta; queda apuntada como su sustituta natural.

> **ELI5:** es un karaoke de partituras. OSMD es el dibujante contratado: dibuja la partitura y sabe señalar notas. ScoreView es el encargado de obra, el único que habla con el dibujante: si un día cambias de dibujante, solo el encargado aprende el idioma nuevo. El reloj es un cronómetro de cocina que se puede pausar; y el puntero es un dedo que recorre la lista de notas: a cada parpadeo de la pantalla mira el cronómetro y, si ya es la hora de la siguiente nota, el dedo avanza y le grita al encargado "¡señala la 14!".
>
> ¿Y por qué no puedes abrir el fichero con doble clic? Porque el navegador trata cada página como un desconocido en la puerta: a las páginas que llegan "de la calle" (file://) no las deja abrir los cajones de tu casa (fetch de ficheros). El servidorcito local es darle a la página un DNI del barrio.

### Por qué así y por qué ahora

CDN en vez de npm porque el viewer del andamiaje es una página estática: tres ficheros que un `http.server` sirve tal cual. Un bundler (la herramienta que empaqueta módulos npm para el navegador: Vite, webpack) es una hipoteca sin casa hoy: config, node_modules, un paso de build entre tú y cada prueba. Cuando el viewer crezca (MVP, con el diapasón dibujado y el Corrector en pantalla), migrar a npm+Vite es una hora de trabajo y ese día la hipoteca compra una casa que existe. El puntero en vez de búsqueda binaria: es la versión de menos código que es igual de correcta para los gestos del andamiaje (play, pausa, reinicio), y su sustituto está nombrado para cuando el gesto nuevo aparezca. Las dos son decisiones reversibles con el camino de vuelta escrito: lo contrario de un atajo.

> **Comprobación:** con la escala del bloque 1: play, el cursor pisa las 8 notas a ritmo constante (compruébalo contando "un, dos" en voz alta: a 80 BPM es un paso cada 0.75 s); pausa y reanuda sin saltos; reiniciar vuelve al principio. Todo con el engine todavía sin existir: estás viendo el fixture a mano moverse.

**Para discutir:** dos desvíos deliberados respecto al diseño cerrado (CDN en vez de dependencia npm, puntero en vez de búsqueda binaria). Los dos reversibles y con camino de vuelta nombrado; si alguno te chirría, es exactamente la conversación que este documento quiere provocar.

---

## Bloque 4 · Integración: la pieza real y el riesgo de verdad (tipo: verificación)

**Al acabar:** la Gavotte de Gossec se recorre sola en pantalla, al tempo, y el andamiaje queda cerrado y publicado.

### Cómo lo haría, paso a paso

Ejecutar el engine sobre la Gavotte, abrir el viewer con su MusicXML y su timeline.json, y pasar una checklist corta y concreta:

- El cursor pisa la primera nota en el segundo 0 (no antes, no después).
- A mitad de pieza sigue en la nota que suena: se comprueba cantando la melodía o con un metrónomo al lado a los BPM del timeline. Oído y máquina de acuerdo = las dos mitades del sistema de acuerdo.
- Llega a la última nota en el instante que dice el último `start_s`, cronómetro en mano.
- Pausa, reanudación y reinicio funcionan en una pieza larga, no solo en la escala.

Sobre la **deriva** (que el cursor se desincronice poco a poco): con esta arquitectura no puede acumularse, y entender por qué es un buen repaso de todo el diseño. El cursor no "suma pasitos" (donde cada error se arrastraría): en cada frame consulta el reloj absoluto y busca el evento que corresponde a *ese* instante. El error máximo posible es un frame de pantalla (~16 ms), invisible, y no crece con la duración de la pieza. Si en la práctica la deriva aparece, no puede ser del reloj: será que los `start_s` del engine están mal calculados, y la frontera-fichero te dice exactamente dónde mirar.

Al cerrar la checklist: README con un gif del cursor moviéndose (el gif es lo primero que un visitante mira en un repo), commit y push. Este es el momento "repo presentable" que el bloque 0 pospuso.

> **ELI5:** el ensayo general con público: hasta ahora cada músico ensayó su parte en su casa (el engine con su test, el viewer con el fixture); esta es la primera vez que tocan juntos la obra entera. Si algo desafina, es aquí donde se oye. Y lo de la deriva: el cursor no camina con los ojos cerrados contando pasos (así se pierde cualquiera); mira el reloj de la pared a cada paso y se planta donde toca. No puede perderse más de un paso, ni acumular retraso.

### Por qué así y por qué ahora

Este bloque existe porque la apuesta más arriesgada de todo el diseño no es el LLM ni el ML: es que **el evento n del timeline y el paso n del cursor de OSMD son la misma nota** en una partitura real. La escala no puede desmentirlo (no tiene silencios ni ligaduras); la Gavotte sí. Bajo el capó, el cursor de OSMD recorre "entradas de voz" (cada golpe de escritura en el pentagrama: nota, acorde o silencio), y nuestra apuesta es que, saltando silencios en `_enSilencio()`, esas entradas casan una a una con `part.notes` de music21. Las amenazas conocidas: silencios (ya resueltos), ligaduras (dos entradas, dos eventos: consistente por la decisión del bloque 2), notas de adorno y varias voces en un pentagrama (raras en repertorio de inicio; la Gavotte dirá). Si la correspondencia se rompe, se descubre aquí, con dos ficheros de código escritos y el arreglo localizado. Descubrirlo en el MVP, con el Corrector acusando a la nota equivocada, costaría diez veces más y se manifestaría como el peor tipo de bug: feedback pedagógico incorrecto que parece correcto.

> **Comprobación:** la checklist entera en verde sobre la Gavotte, y el repo público con README y gif. Esa es la definición de "andamiaje terminado" del diseño, cumplida.

**Para discutir:** si la correspondencia nota-cursor falla en la Gavotte, hay dos salidas: enriquecer la lógica de avance de ScoreView (mi primera opción: mantiene el contrato limpio y la fricción pagada en un solo fichero) o meter los silencios en el timeline (cambia el contrato y toca actualizar el diseño). No lo decidimos hoy: se decide con el fallo delante, si aparece.

---

## YAGNI: lo que el andamiaje no lleva, a propósito

YAGNI ("you aren't gonna need it"): la disciplina de no construir para necesidades que aún no existen, porque lo especulativo casi siempre se especula mal y se mantiene siempre.

- **Intérprete LLM y curva de tempo:** MVP. El cursor a BPM constante ya valida todo lo demás.
- **PDF y OMR (Audiveris):** MVP. El andamiaje entra por MusicXML directo.
- **Audio, micrófono y ML:** MVP (Listener). Aquí ni se graba ni se escucha.
- **SQLite / practice.db:** MVP. No hay resultados que doler perder todavía (regla del estado, deep dive 4).
- **npm, bundler, framework JS:** tres ficheros estáticos no lo justifican; migración de una hora cuando lo justifiquen.
- **Digitación y cuerda:** los campos viajan a `null`; los rellena el LLM en el MVP.
- **Empaquetado app (Tauri/pywebview):** pospuesto indefinidamente por diseño; la frontera JSON mantiene la puerta abierta gratis.

## Los planes de ML: documento propio

El camino del Listener (fundamentos de audio, baseline pYIN, el harness de evaluación, CREPE, tu modelo propio, vibrato, y el puente con las JDs de AI Engineer) vive aparte, con la profundidad que la zona de diseño de ML merece: [listener-ml.md](listener-ml.md). Prerrequisito para arrancarlo: este andamiaje cerrado, porque el audio sintético de su etapa L1 nace del engine.

## Las decisiones sobre la mesa

Resumen de todo lo discutible, con mi posición en una línea. El resto del documento argumenta cada una.

1. **Repo público desde el día uno.** Propongo que sí.
2. **Silencios fuera del timeline** y el cursor los salta en ScoreView. Propongo mantener el contrato del diseño.
3. **OSMD por CDN, sin npm ni bundler** en el andamiaje. Desvío del diseño, reversible en una hora.
4. **Puntero que avanza en vez de búsqueda binaria.** Desvío del diseño; la búsqueda vuelve con "saltar a compás".
5. **Ligaduras como eventos separados** hasta que el Corrector obligue a decidir.
6. **Dobles cuerdas: nota aguda** en el andamiaje; el acorde real, en el MVP.
7. **En ML, la regla de medir (L1) va antes que cualquier modelo**, y el sintético sale del propio engine.

Si las siete pasan la conversación, el siguiente paso es mecánico: crear el repo y ejecutar los bloques 0 y 1 en una sesión corta. Bloques 2 y 3 pueden ir en paralelo o en tardes separadas; el 4 cierra y publica.
