"""Módulo de datos: carga y gestiona la base de posiciones tácticas."""
from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import List

from . import config


@dataclass(frozen=True)
class Puzzle:
    """Una posición táctica de la base Woodpecker."""

    id: int
    fen: str
    side_to_move: str          # "w" | "b"
    expected_result: str       # "1-0" | "0-1" | "1/2-1/2"

    @property
    def solving_side(self) -> str:
        """Bando que debe resolver (el que mueve)."""
        return self.side_to_move

    @property
    def goal(self) -> str:
        """Objetivo del problema: 'win_white', 'win_black' o 'draw'."""
        if self.expected_result == "1-0":
            return "win_white"
        if self.expected_result == "0-1":
            return "win_black"
        return "draw"


def load_puzzles(path: Path | None = None) -> List[Puzzle]:
    """Carga las posiciones desde el JSON entregado con las especificaciones."""
    path = path or config.PUZZLES_JSON
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    puzzles = [
        Puzzle(
            id=int(item["id"]),
            fen=item["fen"],
            side_to_move=item["sideToMove"],
            expected_result=item["expectedResult"],
        )
        for item in raw
    ]
    puzzles.sort(key=lambda p: p.id)
    return puzzles


def build_queue(
    puzzles: List[Puzzle],
    range_start: int,
    range_end: int,
    order: str,
    seed: int | None = None,
) -> List[Puzzle]:
    """Construye la cola de la sesión según rango y orden.

    order: 'secuencial' o 'aleatorio'.
    """
    selected = [p for p in puzzles if range_start <= p.id <= range_end]
    if order == "aleatorio":
        rng = random.Random(seed)
        rng.shuffle(selected)
    else:
        selected.sort(key=lambda p: p.id)
    return selected
