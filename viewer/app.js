// El reloj y el puntero. No sabe nada de OSMD ni de cómo se dibuja: solo lee
// el timeline, cuenta segundos y le pide a ScoreView dónde poner el cursor.

const piece = new URLSearchParams(location.search).get("piece") || "escala-sol";

const reloj = {
  corriendo: false,
  t0: 0,
  transcurrido: 0,
  indice: 0,
};

let timeline = null;
let parte = null;
let bpm = 100;
let vista = null;

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

function tick() {
  if (!reloj.corriendo) return;

  const t = segundosAhora();
  situarPuntero(t);
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

function cambiarDeVoz(indiceParte) {
  parte = timeline.parts[indiceParte];
  const t = segundosAhora();
  reloj.indice = 0;
  situarPuntero(t);
  pintarEstado(t);
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
  el("tempo").textContent = `${bpm} bpm (${timeline.tempo_source})`;

  const selector = el("voz");
  timeline.parts.forEach((p, i) => {
    selector.add(new Option(`${p.name} (${p.events.length})`, i));
  });
  selector.disabled = timeline.parts.length < 2;
  selector.addEventListener("change", (e) => cambiarDeVoz(Number(e.target.value)));

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
  if (e.code === "Space" && e.target.tagName !== "SELECT") {
    e.preventDefault();
    reloj.corriendo ? pausar() : tocar();
  }
});

iniciar();
