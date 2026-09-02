"""Sirve el visor y las piezas. El contrato del timeline se valida al salir."""

import json
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

RAIZ = Path(__file__).resolve().parent.parent
PIEZAS = RAIZ / "data" / "pieces"
VISOR = RAIZ / "viewer"


class MarcaDeTempo(BaseModel):
    measure: int
    bpm: float


class Evento(BaseModel):
    index: int
    pitch: str | None
    freq_hz: float | None
    start_s: float
    duration_s: float
    measure: int
    beat: float


class Timeline(BaseModel):
    piece: str
    tempo_map: list[MarcaDeTempo]
    tempo_source: Literal["cli", "score", "default"]
    events: list[Evento]


app = FastAPI(title="Atril")


def carpeta_de(piece: str) -> Path:
    carpeta = (PIEZAS / piece).resolve()
    if carpeta.parent != PIEZAS.resolve() or not carpeta.is_dir():
        raise HTTPException(status_code=404, detail=f'No existe la pieza "{piece}"')
    return carpeta


@app.get("/api/pieces")
def listar_piezas() -> list[str]:
    return sorted(p.name for p in PIEZAS.iterdir() if (p / "timeline.json").exists())


@app.get("/api/pieces/{piece}/timeline")
def leer_timeline(piece: str) -> Timeline:
    fichero = carpeta_de(piece) / "timeline.json"
    if not fichero.exists():
        raise HTTPException(status_code=404, detail=f'"{piece}" no tiene timeline.json')
    return Timeline(**json.loads(fichero.read_text()))


@app.get("/api/pieces/{piece}/score.musicxml")
def leer_partitura(piece: str) -> FileResponse:
    fichero = carpeta_de(piece) / "score.musicxml"
    if not fichero.exists():
        raise HTTPException(status_code=404, detail=f'"{piece}" no tiene partitura')
    return FileResponse(fichero, media_type="application/vnd.recordare.musicxml+xml")


app.mount("/", StaticFiles(directory=VISOR, html=True), name="viewer")
