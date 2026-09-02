// Único fichero que sabe que OSMD existe. Si algún día se cambia de librería
// de dibujo, se reescribe esto y nadie más se entera.

class ScoreView {
  constructor(container) {
    this.osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
      autoResize: true,
      drawTitle: false,
      drawPartNames: false,
      followCursor: true,
    });
    this.indiceActual = -1;
  }

  async cargar(urlMusicXml) {
    await this.osmd.load(urlMusicXml);
    this.osmd.render();
    this.osmd.cursor.show();
    this.indiceActual = 0;
  }

  // Mueve el cursor al evento n del timeline. Cuenta con que el timeline
  // incluye los silencios, porque el cursor de OSMD también los recorre.
  irA(indice) {
    if (indice === this.indiceActual) return;

    if (indice < this.indiceActual) {
      this.osmd.cursor.reset();
      this.indiceActual = 0;
    }
    while (this.indiceActual < indice) {
      this.osmd.cursor.next();
      this.indiceActual += 1;
    }
  }

  reiniciar() {
    this.osmd.cursor.reset();
    this.indiceActual = 0;
  }
}
