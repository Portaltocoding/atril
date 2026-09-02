# El camino del Listener

La zona de diseño de ML de Atril, a fondo: fundamentos de audio desde cero, el baseline, la regla de medir, los rivales, tu modelo propio, y el puente con lo que piden las JDs de AI Engineer. Los modelos los escribes tú; este documento es la arquitectura y el orden.

- Diseño completo del sistema: https://claude.ai/code/artifact/7244a4ad-a990-4360-bf36-f9fd37ae699f
- Plan del andamiaje: [andamiaje.md](andamiaje.md)
- Versión artifact de este documento: https://claude.ai/code/artifact/7e2e258f-9c28-49b6-9cd0-b07d3771c2ce

## Encaje: qué es el Listener y qué le debe al resto

El Listener es la caja discontinua del diseño: recibe audio (WAV mono, 44.1 kHz, 16 bit) y produce `note_events.json` (qué notas sonaron, cuándo, a qué frecuencia, con qué confianza). Nada más y nada menos. El resto de Atril lo trata como caja negra: mientras el fichero de salida respete el contrato, puedes cambiar de algoritmo cuantas veces quieras sin que nadie se entere. Esa libertad es el regalo de la arquitectura de fronteras-fichero, y este documento es el plan de cómo gastarla bien.

El reparto de papeles, el acordado: los modelos los escribes tú, línea a línea; Claude hace de arquitecto y revisor (diseño, discusión de resultados, revisión de código), no de generador. El objetivo es doble y explícito: que Atril oiga bien, y que tú salgas del camino sabiendo hacer ML de verdad, con las cicatrices que las JDs llaman "hands-on experience".

El orden de las etapas es la tesis del documento: **baseline → regla de medir → rival preentrenado → modelo propio → detalle fino**. Nunca al revés, y la etapa más importante no es ningún modelo: es la regla de medir.

---

## Fundamentos: el audio desde cero, de menos a más

Todo el vocabulario del campo, en el orden en que un concepto necesita al anterior. Con esto, cualquier paper o tutorial de pitch detection se deja leer.

### 1 · Sonido digital: muestras

Un micrófono convierte presión de aire en voltaje; la tarjeta de sonido mide ese voltaje 44 100 veces por segundo y guarda cada medida como un número de 16 bits. Eso es un WAV: una lista larguísima de números (44 100 por segundo). El teorema de muestreo (Nyquist) dice que midiendo a 44.1 kHz capturas fielmente cualquier frecuencia hasta 22.05 kHz, que cubre de sobra todo lo que un violín y un oído producen y perciben.

### 2 · f0 y armónicos: qué es "la nota"

Una cuerda frotada no vibra a una sola frecuencia: vibra entera (la **fundamental**, f0) y a la vez en mitades, tercios, cuartos… (los **armónicos**: 2×f0, 3×f0, 4×f0…). Un La 440 de violín tiene energía en 440, 880, 1320, 1760 Hz… La nota que percibes es la fundamental; el reparto de energía entre armónicos es el timbre (por eso un violín y una flauta tocando La 440 suenan distinto siendo la misma nota). "Detectar pitch" = estimar f0 a lo largo del tiempo, ignorando el disfraz de los armónicos: y ese disfraz es exactamente lo que hace el problema difícil, porque un detector ingenuo confunde f0 con sus armónicos (el clásico error de octava).

### 3 · Frames: trocear el tiempo

La señal cambia (cada nota dura décimas de segundo), así que se analiza por **ventanas** cortas: trozos de ~2048 muestras (46 ms) que avanzan a saltos de 512 muestras (el **hop**, ~11.6 ms). Cada trozo analizado es un **frame**, y el resultado de cualquier análisis es una serie temporal: un valor cada ~11.6 ms. Hay un compromiso físico irreducible: ventana larga = frecuencia precisa pero tiempo borroso; ventana corta = al revés. 2048/512 a 44.1 kHz es el punto medio estándar para música.

### 4 · FFT y espectrograma: de oír a ver

La **FFT** (transformada rápida de Fourier) descompone una ventana en sus frecuencias: cuánta energía hay en cada "bin" (casilla) de frecuencia. Aplicada frame a frame y pintada (tiempo en horizontal, frecuencia en vertical, energía como brillo), produce el **espectrograma**: el audio convertido en imagen. En un espectrograma de violín, cada nota se ve como una escalera de rayas horizontales (f0 abajo, armónicos encima). Que el audio se pueda convertir en imagen es lo que permite atacar el problema con redes convolucionales, que son maquinaria de ver.

### 5 · CQT: el espectrograma afinado

La FFT reparte sus bins linealmente (cada 21.5 Hz con nuestra ventana). Pero la música es logarítmica: entre Sol3 (196 Hz) y Sol#3 hay 11.7 Hz, y entre Sol6 y Sol#6 hay 93: los mismos "un semitono" ocupan anchos totalmente distintos. La **CQT** (constant-Q transform) espacia los bins logarítmicamente, por ejemplo 36 por octava (3 por semitono), de modo que un semitono mide lo mismo en toda la imagen. Para pitch en música es la representación estándar: la red ve las notas como las ve un músico. En librosa: `librosa.cqt(y, sr=sr, fmin=librosa.note_to_hz("E3"), n_bins=180, bins_per_octave=36)` cubre 5 octavas desde justo debajo del registro del violín.

### 6 · Cents: la unidad del error

100 cents = un semitono, en escala logarítmica como el oído: `desviación = 1200 · log₂(f_detectada / f_objetivo)`. Calibración de intuición: ±5 cents es afinación profesional, ±15 empieza a oírse feo, ±50 es medio semitono (nota equivocada, más que desafinada). Los cents son la moneda de todo Atril: el Listener los mide, el Corrector los convierte a milímetros de dedo, el heatmap los acumula.

> **ELI5:** el WAV es una película del altavoz: 44 100 fotogramas por segundo de "dónde está la membrana". La FFT es un prisma: le entra luz blanca (la ventana de audio) y saca el arcoíris (qué frecuencias contiene). El espectrograma es filmar el arcoíris: una foto del prisma cada centésima, pegadas en una tira. Y la CQT es imprimir esa tira sobre papel pautado de músico, donde cada semitono ocupa un renglón igual de alto, en vez de sobre papel milimetrado de físico.

---

## Etapa L0 · Baseline sin ML: pYIN (una tarde)

**YIN** (2002) detecta f0 por autocorrelación: prueba desplazamientos temporales de la señal contra sí misma y busca el que mejor encaja; ese periodo es 1/f0. **pYIN** (2014) lo mejora manteniendo varias hipótesis por frame y suavizándolas con un modelo oculto de Márkov (una máquina de estados probabilística que penaliza saltos bruscos), con lo que casi elimina el error de octava. Viene en **librosa**, la librería estándar de análisis musical en Python, y no tiene ni una neurona: es señal pura.

```python
import librosa

y, sr = librosa.load("toma.wav", sr=44100, mono=True)
f0, voiced, prob = librosa.pyin(
    y, sr=sr,
    fmin=180,     # justo bajo el G3 del violin (196 Hz), su nota mas grave
    fmax=1500)    # de sobra para primeras posiciones
# f0:     un valor de pitch por frame (~11.6 ms), NaN donde no hay nota
# voiced: booleano por frame, "aqui suena algo con pitch"
```

Encima, la **segmentación** que convierte la curva de pitch en notas discretas, en versión ingenua y transparente:

1. Recorrer los frames; abrir una nota cuando `voiced` pasa a activo.
2. Mientras el pitch del frame no se aleje más de ±50 cents de la mediana de la nota abierta, la nota sigue.
3. Al romperse cualquiera de las dos condiciones, cerrar la nota: `onset_s` = primer frame × hop/sr, `duration_s` = nº de frames × hop/sr, `f0_hz` = mediana, `confidence` = media de `prob`, `f0_track_hz` = la curva recortada.
4. Descartar notas de menos de ~80 ms (los roces de arco producen fantasmas cortísimos).

Con eso se emite un `note_events.json` válido y todo el sistema aguas abajo tiene con qué funcionar. La segmentación es la parte con más decisiones arbitrarias (¿50 cents? ¿80 ms?): apúntalas como parámetros con nombre, porque son exactamente lo que las etapas siguientes ajustarán con datos.

> **ELI5:** antes de fabricar un oído artificial, compras el oído más simple de la tienda y compruebas que todo el cuerpo funciona con él. Y el truco de YIN: si gritas en un cañón, el eco encaja contigo cuando el retardo coincide con tu ritmo; YIN prueba todos los retardos y se queda con el que mejor encaja. Ese ritmo ES la nota.

> **Cierre de etapa:** grabas una escala con el móvil, corres el script, y el `note_events.json` tiene un evento por nota tocada con frecuencias que un afinador confirmaría. Sin métrica formal todavía: eso es L1, y la tentación de saltársela es el primer examen del camino.

---

## Etapa L1 · La regla de medir: el harness de evaluación

Un **harness** es un banco de pruebas: un script que somete a cualquier Listener al mismo examen y saca la misma tabla de números. Se construye *antes* que ningún modelo porque define qué significa "mejor": sin él, comparar dos algoritmos es comparar sensaciones. Es la etapa con menos glamour y más valor de todo el camino, y la costumbre que separa el ML serio del ML de demo.

### Las dos fuentes de verdad

- **Audio sintético con etiquetas perfectas.** El `timeline.json` que ya produce el engine se convierte a MIDI y se sintetiza a WAV con **FluidSynth** (un sintetizador que reproduce MIDI usando una **soundfont**: un banco de muestras grabadas; hay soundfonts de violín gratuitas, p. ej. la de FluidR3). Como el timeline dice exactamente qué suena y cuándo, el **ground truth** (la hoja de respuestas) es exacto al milisegundo y gratis en cualquier cantidad: cada pieza nueva del atril es un examen nuevo. `fluidsynth -ni violin.sf2 pieza.mid -F pieza.wav -r 44100`. El engine del andamiaje se convierte así en tu generador de exámenes: la jugada bonita de la arquitectura, y sale gratis de la frontera-fichero.
- **Grabaciones tuyas etiquetadas a mano.** Escalas y notas largas con el afinador delante, pocas pero reales: arco, resonancia del cuarto, ruido del móvil, todo lo que el sintético no tiene. El sintético da volumen y exactitud; lo real da honestidad. La regla de oro: **la nota que decide es siempre la del examen real**; el sintético orienta, lo real veredicta.

### Las métricas, con fórmula

Con **mir_eval**, la librería académica de referencia para evaluar análisis musical (usarla hace tus números comparables con la literatura): `mir_eval.transcription.precision_recall_f1_overlap` empareja notas detectadas con notas verdaderas y calcula:

- **Precisión** = aciertos / detectadas. De las notas que dijiste, ¿cuántas existían? Castiga inventar.
- **Recall** = aciertos / verdaderas. De las que sonaron, ¿cuántas cazaste? Castiga saltarse.
- **F1** = media armónica de ambas: un solo número cuando hace falta ordenar, sabiendo que esconde el detalle.
- Una nota cuenta como acierto si su onset cae a ±50 ms del verdadero (el estándar del campo: por debajo ni un humano distingue el ataque) y su pitch a ±50 cents.
- **Error medio de pitch en cents** sobre los aciertos, aparte: la métrica que alimenta al producto, porque el "mueve el dedo 5 mm" del Corrector se calcula desde cents. Si el Listener yerra ±20 cents, los milímetros serán mentira: este número es el techo de calidad de todo Atril.

### El registro de experimentos

Cada ejecución del harness añade una fila a `listener/evals/results.csv`: fecha, hash del commit (`git rev-parse --short HEAD`), nombre y parámetros del Listener, dataset, y las métricas. Un CSV y disciplina, nada más: MLflow y compañía (plataformas de tracking de experimentos) entran el día que el CSV duela de verdad, no antes. Lo que no se negocia es el hábito: **ningún experimento sin fila, ninguna fila sin commit**: un resultado que no puedes reproducir no es un resultado, es una anécdota.

> **ELI5:** el examen tipo test con hoja de respuestas: el sintético es el examen cuyas soluciones escribiste tú; tus grabaciones son el examen del mundo real, con manchas de café. Todo oído nuevo hace los dos, y gana el que saque más nota, no el que suene más moderno. Y el CSV es el cuaderno del laboratorio: sin apuntar qué mezclaste, un descubrimiento es solo una explosión con suerte.

> **Cierre de etapa:** `uv run python -m listener.evals.run --listener pyin` imprime la tabla y añade la fila. pYIN tiene sus números en sintético y en real: a partir de aquí, todo lo que entre se compara contra algo.

---

## Etapa L2 · CREPE: el rival preentrenado

**CREPE** (2018, NYU): una red convolucional de 6 capas que estima pitch directamente desde la onda cruda (sin espectrograma previo: la red aprende su propia representación). Emite, cada 10 ms, una distribución sobre 360 bins de 20 cents más una confianza; con `viterbi=True` suaviza la trayectoria igual que pYIN con su Márkov. Pesos preentrenados publicados, `pip install crepe`, y varios tamaños (de `tiny` a `full`). Fue el estado del arte en pitch durante años y sigue siendo el rival a batir por defecto.

El trabajo de la etapa: escribirle el adaptador (CREPE da curva de pitch, no notas: tu segmentación de L0 se reutiliza encima, y esa reutilización te enseña que *pitch tracking* y *transcripción a notas* son dos problemas apilados), pasarle el examen de L1 completo, y leer la tabla con frialdad, coste incluido: CREPE es una red (más lenta y pesada que pYIN; medir milisegundos por segundo de audio también es parte de la tabla). O gana en tu violín, tu cuarto y tu micrófono, o no entra: nada de adoptar por fama.

Esta etapa te regala, en pequeño, el rito completo de "evaluar un modelo ajeno contra mi benchmark antes de adoptarlo", que es el gesto central del oficio y la respuesta a media entrevista de AI engineering.

> **Cierre de etapa:** dos filas nuevas en el CSV (CREPE tiny y full), y una decisión escrita en una línea: quién es el Listener titular y por qué números.

---

## Etapa L3 · Modelo propio: el objetivo de aprendizaje

Con baseline, harness y rival en la mano, entrenar el tuyo deja de ser un salto al vacío: cada idea es un experimento con su fila.

### Los datos

| Dataset | Qué es | Para qué te sirve |
|---|---|---|
| MDB-stem-synth | pistas reales resintetizadas de modo que la f0 de cada instante se conoce por construcción | entrenar pitch con etiqueta perfecta; el equivalente público de tu truco del sintético |
| URMP | música de cámara grabada con pistas separadas por instrumento y anotación por nota | violín real con verdad por nota; lo más parecido a tu caso de uso |
| Bach10 | 10 corales a 4 instrumentos, pequeño y limpio | set de validación compacto y clásico |
| MusicNet | 330 grabaciones anotadas, mucho volumen | útil por tamaño, con fama de etiquetas algo ruidosas: bueno saberlo antes de fiarse |
| Tus grabaciones | tu violín, tu cuarto, tu móvil | el test set sagrado: nunca se entrena con él, nunca se decide mirándolo dos veces |

El **split** (la partición de datos) con su porqué: se entrena con lo público y lo sintético; se valida (elegir hiperparámetros, decidir cuándo parar) con una porción reservada de eso mismo; y el **test es tu caso real** y se mira lo mínimo, porque cada mirada que influye en una decisión lo va gastando: un test que has usado veinte veces para elegir ya es, en la práctica, un set de validación con ínfulas. La distinción entre "datos para aprender", "datos para elegir" y "datos para veredicto final" es el corazón metodológico de todo ML.

**Augmentation** (aumentar datos con variaciones sintéticas): ruido de fondo a varios niveles, cambios de ganancia, algo de reverberación: todo eso hace al modelo robusto al mundo real y no toca las etiquetas. Cuidado con el pitch-shift (desplazar el tono): cambia la etiqueta de pitch, así que solo vale si desplazas la etiqueta exactamente igual; es la augmentation clásica que, mal hecha, envenena silenciosamente el dataset.

### Los modelos, en orden

1. **Detector de onsets:** una CNN pequeña sobre espectrograma (el diseño clásico de Schlüter y Böck, 2014: unas pocas capas convolucionales que responden "¿empieza una nota en este frame?"). Es el problema más sencillo de los dos y enseña el ciclo completo (datos → entrenamiento → fila en el CSV) con poca arquitectura. madmom (librería alemana de MIR) trae detectores preentrenados que sirven de referencia a batir.
2. **Estimador de pitch:** entrada, un parche de CQT (180 bins × ~15 frames: la nota y su contexto inmediato); salida, softmax sobre bins de 20 cents (clasificación, no regresión: igual que CREPE, porque una distribución expresa "aquí o quizá en la octava" mejor que un número seco, y da la confianza gratis). Truco de CREPE que conviene copiar: la etiqueta no es un bin seco sino una campanita gaussiana alrededor del bin verdadero, que le dice a la red que errar por 20 cents es casi acertar y errar por una octava es un desastre; la cross-entropy contra esa campanita hace el resto.
3. **El Listener completo:** onsets + pitch + tu segmentación, empaquetado tras el contrato. Misma cara externa que pYIN: `note_events.json`.

El bucle de entrenamiento, en PyTorch y sin frameworks encima (el bucle explícito es el punto de la etapa: verlo entero una vez en la vida):

```python
torch.manual_seed(42)                    # reproducibilidad: mismo azar, mismo resultado
model = PitchCNN().to(dev)
opt = torch.optim.AdamW(model.parameters(), lr=3e-4)
for epoch in range(epochs):
    for x, y in train_loader:            # x: parches CQT, y: campanitas sobre bins
        opt.zero_grad()
        loss = F.cross_entropy(model(x.to(dev)), y.to(dev))
        loss.backward()                  # gradientes
        opt.step()                       # un pasito contra la perdida
    val = evaluar(model, val_loader)     # ¿mejora en datos no vistos?
    # early stopping: si val lleva N epochs sin mejorar, parar: seguir es memorizar
```

Y la ambición bien puesta: no es batir a CREPE en general (eso es un paper, y no es el proyecto); es batirlo **en tu caso**: un violín, un cuarto, un micrófono. Ahí un modelo pequeño y especializado puede ganar al gigante generalista, y el "overfitting a tu violín", que en un paper sería un defecto, aquí se llama producto personalizado. Si no lo bate, también está bien: la tabla manda, CREPE se queda de titular, y el aprendizaje ya está cobrado.

> **ELI5:** escuela de cocina: primero recetas ajenas (pYIN), luego el plato del restaurante famoso (CREPE), y solo entonces tu receta, porque ya tienes paladar (las métricas). Los tres montones de datos: el de practicar, el de probar mientras cocinas, y el plato que le sirves al crítico: si el crítico prueba tus ensayos, su opinión ya no vale. Y la campanita gaussiana: al niño que dice "casi" no se le pone el mismo cero que al que dice cualquier cosa.

> **Cierre de etapa:** tu modelo tiene sus filas en el CSV, en sintético y en real, contra pYIN y CREPE. Hay un titular elegido por números y un párrafo escrito de por qué. Ese párrafo, tal cual, es material de portfolio.

---

## Etapa L4 · Vibrato y detalle fino

El vibrato es la oscilación periódica del pitch alrededor de la nota (típicamente 5-7 ciclos por segundo, ±20 a ±50 cents de anchura) que el violinista produce meciendo el dedo. Para un detector ingenuo es indistinguible de "desafinado inestable", y ahí está el problema fino: el Corrector no debe regañar un vibrato bonito. El campo `f0_track_hz` del contrato (la curva de pitch cada ~10 ms dentro de cada nota) ya reserva el sitio. La receta: restar a la curva su mediana (queda solo la oscilación), FFT de ese residuo, y buscar un pico en 4-8 Hz; su frecuencia es la velocidad del vibrato, su amplitud la anchura en cents, y el centro de la oscilación es lo que se juzga contra la partitura. Investigación de la buena, y no bloquea nada: el Corrector funciona desde L0 con una tolerancia más ancha mientras tanto.

---

## Ingeniería: tratar el ML como software

Las costumbres que hacen que esto sea ingeniería y no alquimia. Ninguna es opcional en el camino, y todas son baratas si se instalan desde L0:

- **Estructura:** `listener/models/` (un módulo por Listener: `pyin.py`, `crepe_adapter.py`, `own/`), `listener/evals/` (harness, `results.csv`, manifests de datasets), `listener/segment.py` (la segmentación, compartida por todos). Todos los modelos exponen la misma función: `transcribe(wav_path) -> list[NoteEvent]`; el harness no sabe cuál corre.
- **Los WAV no van a git:** pesan y no se diffean. Va un manifest (`datasets.json`: nombre, origen, hash de cada fichero) y los datos viven fuera del repo. El hash detecta el clásico "me cambió el dataset sin darme cuenta", que invalida en silencio toda comparación entre filas del CSV.
- **Tests para el código de datos:** la segmentación se testea con curvas sintéticas fabricadas en el test (una curva plana a 440 con un hueco = dos notas exactas). El código de datos es donde viven los bugs más caros del ML, porque no revientan: solo bajan la nota sin decir por qué.
- **Contratos validados:** un modelo Pydantic para `NoteEvent` (tipos, rangos: `confidence` entre 0 y 1, tiempos no negativos) validando cada JSON al escribirlo y al leerlo. El fichero sigue siendo la frontera; Pydantic es el inspector de aduanas.
- **Semillas y versiones:** `torch.manual_seed`, versiones clavadas en `uv.lock`, hash de commit en cada fila del CSV. Reproducibilidad no es pureza académica: es poder responder "¿por qué el de hace dos semanas era mejor?" sin arqueología.

---

## El puente: esto, en el idioma de las JDs

La tabla honesta: qué frase de JD de AI Engineer se entrena de verdad en este camino, dónde, y qué parte no la cubre Atril (para no contarte películas a ti mismo). La columna del medio es, casi literalmente, la historia que se cuenta en la entrevista.

| La JD pide | Dónde lo practicas aquí | Cómo se cuenta |
|---|---|---|
| Automated evaluation frameworks | el harness de L1 entero: golden datasets (sintético + real etiquetado), métricas con umbral, regresión contra un CSV versionado | "monté el eval harness antes que el primer modelo; toda decisión de modelo en el proyecto es una fila en esa tabla". Las métricas de LLM de las JDs (hallucination, groundedness, relevancy) son otras métricas sobre el mismo esqueleto: golden set + métrica + regresión; quien montó un harness sabe montar el otro |
| Hands-on con modelos en producción | L2 y L3: evaluar un preentrenado contra benchmark propio, adaptarlo, decidir por números y coste (latencia incluida) | "CREPE no entró por fama: entró (o no) por su fila en el CSV, contando milisegundos por segundo de audio" |
| Unit testing, CI/CD aplicado a AI | tests del código de datos y la segmentación, contratos Pydantic, harness ejecutable en un comando (= listo para CI el día que haya CI) | "el pipeline de datos tiene tests; el eval es un comando; los contratos se validan en las fronteras" |
| Observabilidad, structured logging | el CSV de experimentos con hash de commit; en el MVP, practice.db como telemetría de producto | "cada run es reproducible: commit, parámetros, dataset con hash, métricas" |
| Prompts avanzados, versionados, testeados | fuera de este doc: es el intérprete LLM del MVP (una llamada cacheada por hash, prompt en el repo, con su propio eval de groundedness: ¿la digitación que propone respeta la partitura?) | se diseñará con su deep dive cuando toque el MVP; el harness de L1 le servirá de molde |
| LangGraph, orquestación, estado, ciclos | fuera de este doc: es el agent Profesor (add-on), un grafo con estado real (la telemetría de practice.db) y bucles de decisión | cuando llegue, llegará con la ventaja rara: un agent con datos objetivos que consumir, no un chatbot de consejos |
| RAG, embeddings, vector DBs | **Atril no lo cubre**, y forzarlo aquí sería postureo de CV: no hay corpus que recuperar | eso se cubre con Kultro y el resto del stack; que este doc lo diga en voz alta es parte de su honestidad |

La tesis del puente: las JDs piden "tratar la AI como ingeniería de software". Este camino es exactamente ese músculo (evals primero, decisiones por números, reproducibilidad, contratos), entrenado en un dominio donde además se nota a oído cuando algo va mal. La capa LLM de las JDs (prompts, orquestación) tiene su sitio reservado en el MVP y los add-ons, cada una con su deep dive cuando toque.

---

## El orden, en una línea cada etapa

1. **L0 · pYIN:** el oído más simple que cumple el contrato, para que el cuerpo entero funcione ya.
2. **L1 · Harness:** la definición de "mejor", antes de que exista nada que comparar. La etapa que lo sostiene todo.
3. **L2 · CREPE:** el rival famoso, sometido al mismo examen; se decide con la tabla, no con el hype.
4. **L3 · El tuyo:** onsets, luego pitch, luego el conjunto; batir al titular en tu violín, no en el mundo.
5. **L4 · Vibrato:** el detalle fino que separa "desafinado" de "expresivo", cuando todo lo demás ya funciona.

Prerrequisito para arrancar L0: el andamiaje cerrado (bloque 4), porque el sintético de L1 nace del engine. Todo lo demás es tuyo.
