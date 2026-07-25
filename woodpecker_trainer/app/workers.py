"""Trabajadores en segundo plano (QThread) para no bloquear la interfaz.

- ``BootstrapWorker``: localiza/descarga Stockfish al arrancar.
- ``OpponentEngine``: calcula la respuesta rápida del rival durante la sesión.
- ``ValidationEngine``: valida las líneas del usuario en segundo plano y en
  silencio (Requisitos 3 y 4).
"""
from __future__ import annotations

from pathlib import Path
from typing import List

import chess
from PyQt6.QtCore import QObject, QThread, pyqtSignal, pyqtSlot

from .data import Puzzle
from .engine import EngineManager, StockfishProvider
from .validator import validate_line


class BootstrapWorker(QThread):
    """Resuelve la ruta de Stockfish (descargándolo si es necesario)."""

    progress = pyqtSignal(str)
    finished_ok = pyqtSignal(str)
    failed = pyqtSignal(str)

    def run(self):  # noqa: D401
        try:
            provider = StockfishProvider()
            path = provider.resolve(progress=self.progress.emit)
            self.finished_ok.emit(str(path))
        except Exception as exc:  # noqa: BLE001
            self.failed.emit(str(exc))


class OpponentEngine(QObject):
    """Motor dedicado a las respuestas del rival (movimientos rápidos)."""

    ready = pyqtSignal(int, str)   # request_id, uci ('' si no hay jugada)

    def __init__(self, binary_path: str):
        super().__init__()
        self._path = binary_path
        self._engine: EngineManager | None = None

    @pyqtSlot()
    def start(self):
        self._engine = EngineManager(Path(self._path), threads=1, hash_mb=64)

    @pyqtSlot(int, str, int)
    def compute(self, request_id: int, fen: str, movetime_ms: int):
        if self._engine is None:
            self.ready.emit(request_id, "")
            return
        board = chess.Board(fen)
        move = self._engine.best_move(board, movetime_ms)
        self.ready.emit(request_id, move.uci() if move else "")

    @pyqtSlot()
    def stop(self):
        if self._engine:
            self._engine.close()
            self._engine = None


class ValidationEngine(QObject):
    """Motor dedicado a validar líneas en segundo plano (análisis profundo)."""

    validated = pyqtSignal(int, object)   # record_index, ValidationResult

    def __init__(self, binary_path: str):
        super().__init__()
        self._path = binary_path
        self._engine: EngineManager | None = None

    @pyqtSlot()
    def start(self):
        self._engine = EngineManager(Path(self._path), threads=1, hash_mb=128)

    @pyqtSlot(int, object, list)
    def validate(self, record_index: int, puzzle: Puzzle, moves: List[str]):
        if self._engine is None:
            return
        result = validate_line(puzzle, moves, self._engine)
        self.validated.emit(record_index, result)

    @pyqtSlot()
    def stop(self):
        if self._engine:
            self._engine.close()
            self._engine = None


def make_worker_thread(worker: QObject) -> QThread:
    """Mueve un worker QObject a su propio hilo y arranca su método ``start``."""
    thread = QThread()
    worker.moveToThread(thread)
    thread.started.connect(worker.start)  # type: ignore[attr-defined]
    thread.start()
    return thread
