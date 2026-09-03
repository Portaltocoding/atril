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
  }

  // El cursor de OSMD no avanza nota a nota de una parte: avanza instante a
  // instante de la partitura entera, así que con varias voces se desincroniza
  // del índice del evento. Por eso se posiciona por tiempo musical.
  irATiempo(negras) {
    const objetivo = negras / 4; // OSMD mide el tiempo en redondas
    const iterador = () => this.osmd.cursor.iterator;

    if (objetivo < iterador().currentTimeStamp.realValue) {
      this.osmd.cursor.reset();
    }
    while (
      !iterador().endReached &&
      iterador().currentTimeStamp.realValue < objetivo - 1e-6
    ) {
      this.osmd.cursor.next();
    }
    // start_s viene redondeado a centésimas, así que en la última nota el
    // objetivo cae unas milésimas por detrás y el cursor se sale del final.
    // Al salirse se apaga: se retrocede una posición y vuelve a verse.
    if (iterador().endReached) {
      this.osmd.cursor.previous();
    }
  }

  reiniciar() {
    this.osmd.cursor.reset();
  }
}
