// El reloj y el puntero. No sabe nada de OSMD ni de Web Audio: lee el timeline,
// cuenta segundos, y le dice a ScoreView dónde poner el cursor y a Sonido qué
// programar. Las dos salidas leen el mismo fichero, sin hablarse entre ellas.

const piece = new URLSearchParams(location.search).get("piece") || "escala-sol";
const HORIZONTE_S = 0.3; // cuánto audio se programa por delante del reloj

const reloj = {
  corriendo: false,
  t0: 0,
  transcurrido: 0,
  indice: 0,
};

const audio = {
  metronomo: false,
  notas: false,
  timbre: "pitido",
  proximoEvento: 0,
  proximoClic: 0,
};

let timeline = null;
let parte = null;
let bpm = 100;
let vista = null;
const sonido = new Sonido();

const el = (id) => document.getElementById(id);

function segundosAhora() {
  return reloj.corriendo
    ? reloj.transcurrido + (performance.now() - reloj.t0) / 1000
    : reloj.transcurrido;
}

function duracionTotal() {
  const ultimo = parte.events[parte.events.length - 1];
  return ultimo.start_s + ultimo.duration_s;
}

// El cursor se pide en tiempo musical, no en segundos: OSMD no sabe de relojes.
function negrasDe(evento) {
  return (evento.start_s * bpm) / 60;
}

function pintarEstado(t) {
  const evento = parte.events[reloj.indice];
  el("tiempo").textContent = t.toFixed(2) + " s";
  el("evento").textContent =
    `${reloj.indice + 1}/${parte.events.length} · ` +
    (evento.pitch.length ? evento.pitch.join(" + ") : "silencio") +
    ` · compás ${evento.measure}, tiempo ${evento.beat}`;
}

function situarPuntero(t) {
  // Puntero lineal: mientras el siguiente evento ya haya empezado, avanza.
  while (
    reloj.indice + 1 < parte.events.length &&
    parte.events[reloj.indice + 1].start_s <= t
  ) {
    reloj.indice += 1;
  }
  while (reloj.indice > 0 && parte.events[reloj.indice].start_s > t) {
    reloj.indice -= 1;
  }
  vista.irATiempo(negrasDe(parte.events[reloj.indice]));
}

// Web Audio se programa por adelantado: aquí se le dan los clics y las notas
// que empiezan en los próximos milisegundos, y él los suena a su hora exacta.
function programarAudio(t) {
  if (!sonido.ctx) return;
  const limite = t + HORIZONTE_S;
  const segundosPorTiempo = 60 / bpm;

  while (audio.metronomo && audio.proximoClic * segundosPorTiempo < limite) {
    const cuando = audio.proximoClic * segundosPorTiempo;
    const primerTiempo = audio.proximoClic % timeline.beats_per_measure === 0;
    sonido.clic(cuando, primerTiempo);
    audio.proximoClic += 1;
  }

  while (
    audio.notas &&
    audio.proximoEvento < parte.events.length &&
    parte.events[audio.proximoEvento].start_s < limite
  ) {
    const ev = parte.events[audio.proximoEvento];
    if (ev.pitch.length) {
      if (audio.timbre === "violin" && sonido.violin) {
        sonido.muestreado(ev.pitch, ev.start_s, ev.duration_s);
      } else {
        sonido.pitido(ev.freq_hz, ev.start_s, ev.duration_s);
      }
    }
    audio.proximoEvento += 1;
  }
}

function reengancharAudio(t) {
  audio.proximoClic = Math.ceil((t * bpm) / 60);
  audio.proximoEvento = parte.events.findIndex((e) => e.start_s >= t);
  if (audio.proximoEvento < 0) audio.proximoEvento = parte.events.length;
}

function tick() {
  if (!reloj.corriendo) return;

  const t = segundosAhora();
  situarPuntero(t);
  programarAudio(t);
  pintarEstado(t);

  if (t >= duracionTotal()) {
    pausar();
    return;
  }
  requestAnimationFrame(tick);
}

async function tocar() {
  if (reloj.corriendo) return;

  const t = reloj.transcurrido;
  if (audio.metronomo || audio.notas) {
    try {
      await sonido.despertar();
      sonido.anclar(t);
      reengancharAudio(t);
    } catch (e) {
      // Sin audio se sigue tocando: el cursor no depende del altavoz.
      console.warn("audio no disponible:", e);
      el("evento").textContent = "sin audio en este navegador";
    }
  }

  reloj.corriendo = true;
  reloj.t0 = performance.now();
  el("play").textContent = "Pausa";
  requestAnimationFrame(tick);
}

function pausar() {
  if (!reloj.corriendo) return;
  reloj.transcurrido = segundosAhora();
  reloj.corriendo = false;
  sonido.callar(); // cancela lo que estuviera programado por delante
  el("play").textContent = "Tocar";
}

function reiniciar() {
  pausar();
  reloj.transcurrido = 0;
  reloj.indice = 0;
  vista.reiniciar();
  pintarEstado(0);
}

function cambiarDeVoz(indiceParte) {
  parte = timeline.parts[indiceParte];
  const t = segundosAhora();
  reloj.indice = 0;
  situarPuntero(t);
  reengancharAudio(t);
  pintarEstado(t);
}

async function elegirTimbre(valor) {
  audio.timbre = valor;
  if (valor !== "violin" || sonido.violin) return;

  const selector = el("timbre");
  selector.disabled = true;
  el("evento").textContent = "cargando el violín…";
  await sonido.cargarViolin();
  selector.disabled = false;
  pintarEstado(segundosAhora());
}

async function iniciar() {
  const respuesta = await fetch(`/api/pieces/${piece}/timeline`);
  if (!respuesta.ok) {
    el("evento").textContent = `No existe la pieza "${piece}"`;
    return;
  }
  timeline = await respuesta.json();
  bpm = timeline.tempo_map[0].bpm;
  parte = timeline.parts[0];

  el("pieza").textContent = timeline.piece;
  el("tempo").textContent =
    `${bpm} bpm (${timeline.tempo_source}) · ${timeline.beats_per_measure} por compás`;

  const selector = el("voz");
  timeline.parts.forEach((p, i) => {
    selector.add(new Option(`${p.name} (${p.events.length})`, i));
  });
  selector.disabled = timeline.parts.length < 2;
  selector.addEventListener("change", (e) => cambiarDeVoz(Number(e.target.value)));

  el("metronomo").addEventListener("change", (e) => {
    audio.metronomo = e.target.checked;
    if (reloj.corriendo) reengancharAudio(segundosAhora());
  });
  el("notas").addEventListener("change", (e) => {
    audio.notas = e.target.checked;
    if (reloj.corriendo) reengancharAudio(segundosAhora());
  });
  el("timbre").addEventListener("change", (e) => elegirTimbre(e.target.value));

  vista = new ScoreView(el("partitura"));
  await vista.cargar(`/api/pieces/${piece}/score.musicxml`);

  pintarEstado(0);
  el("play").disabled = false;
  el("reset").disabled = false;
}

el("play").addEventListener("click", () => (reloj.corriendo ? pausar() : tocar()));
el("reset").addEventListener("click", reiniciar);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !["SELECT", "INPUT"].includes(e.target.tagName)) {
    e.preventDefault();
    reloj.corriendo ? pausar() : tocar();
  }
});

iniciar();
