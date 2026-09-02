// El reloj y el puntero. No sabe nada de OSMD ni de cómo se dibuja: solo lee
// el timeline, cuenta segundos y le pide a ScoreView que mueva el cursor.

const piece = new URLSearchParams(location.search).get("piece") || "escala-sol";

const reloj = {
  corriendo: false,
  t0: 0,
  transcurrido: 0,
  indice: 0,
};

let timeline = null;
let vista = null;

const el = (id) => document.getElementById(id);

function segundosAhora() {
  return reloj.corriendo
    ? reloj.transcurrido + (performance.now() - reloj.t0) / 1000
    : reloj.transcurrido;
}

function duracionTotal() {
  const ultimo = timeline.events[timeline.events.length - 1];
  return ultimo.start_s + ultimo.duration_s;
}

function pintarEstado(t) {
  const evento = timeline.events[reloj.indice];
  el("tiempo").textContent = t.toFixed(2) + " s";
  el("evento").textContent =
    `${reloj.indice + 1}/${timeline.events.length} · ` +
    (evento.pitch ?? "silencio") +
    ` · compás ${evento.measure}, tiempo ${evento.beat}`;
}

function tick() {
  if (!reloj.corriendo) return;

  const t = segundosAhora();

  // Puntero lineal: mientras el siguiente evento ya haya empezado, avanza.
  while (
    reloj.indice + 1 < timeline.events.length &&
    timeline.events[reloj.indice + 1].start_s <= t
  ) {
    reloj.indice += 1;
    vista.irA(reloj.indice);
  }

  pintarEstado(t);

  if (t >= duracionTotal()) {
    pausar();
    return;
  }
  requestAnimationFrame(tick);
}

function tocar() {
  if (reloj.corriendo) return;
  reloj.corriendo = true;
  reloj.t0 = performance.now();
  el("play").textContent = "Pausa";
  requestAnimationFrame(tick);
}

function pausar() {
  if (!reloj.corriendo) return;
  reloj.transcurrido = segundosAhora();
  reloj.corriendo = false;
  el("play").textContent = "Tocar";
}

function reiniciar() {
  pausar();
  reloj.transcurrido = 0;
  reloj.indice = 0;
  vista.reiniciar();
  pintarEstado(0);
}

async function iniciar() {
  const respuesta = await fetch(`/api/pieces/${piece}/timeline`);
  if (!respuesta.ok) {
    el("evento").textContent = `No existe la pieza "${piece}"`;
    return;
  }
  timeline = await respuesta.json();

  el("pieza").textContent = timeline.piece;
  el("tempo").textContent =
    `${timeline.tempo_map[0].bpm} bpm (${timeline.tempo_source})`;

  vista = new ScoreView(el("partitura"));
  await vista.cargar(`/api/pieces/${piece}/score.musicxml`);

  pintarEstado(0);
  el("play").disabled = false;
  el("reset").disabled = false;
}

el("play").addEventListener("click", () =>
  reloj.corriendo ? pausar() : tocar()
);
el("reset").addEventListener("click", reiniciar);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    reloj.corriendo ? pausar() : tocar();
  }
});

iniciar();
