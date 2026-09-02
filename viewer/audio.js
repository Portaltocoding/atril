// Único fichero que sabe de Web Audio. Suena a partir del timeline (freq_hz y
// bpm), nunca a partir de lo que OSMD dibuja: el sonido y la imagen leen el
// mismo fichero por separado.

class Sonido {
  constructor() {
    this.ctx = null;
    this.violin = null; // instrumento muestreado, si se ha cargado
    this.origen = 0; // ctx.currentTime que corresponde al segundo 0 de la pieza
  }

  async despertar() {
    // El navegador solo deja crear audio tras un gesto del usuario.
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  async cargarViolin() {
    if (this.violin) return;
    await this.despertar();
    this.violin = await Soundfont.instrument(this.ctx, "/vendor/violin-mp3.js");
  }

  // Ancla el reloj de audio al reloj de la pieza: a partir de aquí, el segundo
  // t de la pieza es this.origen + t en el reloj del AudioContext.
  anclar(segundosDePieza) {
    this.origen = this.ctx.currentTime - segundosDePieza;
  }

  cuando(segundosDePieza) {
    return this.origen + segundosDePieza;
  }

  clic(segundosDePieza, acentuado) {
    const t = this.cuando(segundosDePieza);
    const osc = this.ctx.createOscillator();
    const vol = this.ctx.createGain();

    osc.frequency.value = acentuado ? 1600 : 1000;
    vol.gain.setValueAtTime(acentuado ? 0.5 : 0.25, t);
    vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    osc.connect(vol).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  pitido(frecuencias, segundosDePieza, duracion) {
    const t = this.cuando(segundosDePieza);
    for (const f of frecuencias) {
      const osc = this.ctx.createOscillator();
      const vol = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.value = f;
      // Ataque y caída cortos: sin esto, cada nota da un chasquido.
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      vol.gain.setValueAtTime(0.22, t + Math.max(duracion - 0.06, 0.03));
      vol.gain.exponentialRampToValueAtTime(0.0001, t + duracion);

      osc.connect(vol).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + duracion + 0.02);
    }
  }

  muestreado(notas, segundosDePieza, duracion) {
    const t = this.cuando(segundosDePieza);
    for (const nombre of notas) {
      this.violin.play(nombre, t, { duration: duracion, gain: 2 });
    }
  }

  callar() {
    if (!this.ctx) return;
    // Cerrar y reabrir es la forma más simple de cancelar todo lo programado.
    this.ctx.close();
    this.ctx = null;
    this.violin = null;
  }
}
