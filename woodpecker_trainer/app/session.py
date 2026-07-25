"""Módulo de sesión: cola de problemas y estado de la sesión de entrenamiento."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from .data import Puzzle
from .validator import ValidationResult


@dataclass
class PuzzleRecord:
    """Lo que el usuario hizo en un problema durante la sesión."""

    puzzle: Puzzle
    full_moves_uci: List[str] = field(default_factory=list)  # usuario + rival
    user_first_uci: str = ""
    time_spent: float = 0.0
    attempt_id: Optional[int] = None
    validation: Optional[ValidationResult] = None
    previous_correct: Optional[bool] = None  # intento anterior (para comparación)

    @property
    def solved_something(self) -> bool:
        return bool(self.full_moves_uci)

    @property
    def transition(self) -> str:
        """Etiqueta de comparación con el intento anterior (Requisito 2)."""
        if self.validation is None:
            return "SIN VALIDAR"
        now = self.validation.is_correct
        if self.previous_correct is None:
            return "NUEVO"
        if self.previous_correct and now:
            return "MANTENIDO ✓"
        if not self.previous_correct and now:
            return "MEJORADO ▲"
        if self.previous_correct and not now:
            return "REGRESIÓN ▼"
        return "SIGUE FALLANDO"


@dataclass
class SessionConfig:
    duration_min: int
    range_start: int
    range_end: int
    order_mode: str                     # "secuencial" | "aleatorio"
    per_puzzle_seconds: Optional[int] = None


class Session:
    """Estado en memoria de una sesión activa."""

    def __init__(self, config: SessionConfig, queue: List[Puzzle], session_id: int):
        self.config = config
        self.queue = queue
        self.session_id = session_id
        self.records: List[PuzzleRecord] = []
        self.index = 0
        self.finish_reason = "en_curso"

    # --- navegación --------------------------------------------------------

    @property
    def total(self) -> int:
        return len(self.queue)

    @property
    def current_puzzle(self) -> Optional[Puzzle]:
        if 0 <= self.index < self.total:
            return self.queue[self.index]
        return None

    def is_finished(self) -> bool:
        return self.index >= self.total

    def commit_record(self, record: PuzzleRecord) -> None:
        self.records.append(record)
        self.index += 1

    # --- métricas ----------------------------------------------------------

    @property
    def solved_count(self) -> int:
        return len(self.records)

    @property
    def correct_count(self) -> int:
        return sum(
            1 for r in self.records
            if r.validation is not None and r.validation.is_correct
        )
