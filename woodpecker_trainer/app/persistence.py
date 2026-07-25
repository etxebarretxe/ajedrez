"""Módulo de persistencia: historial de intentos y sesiones en SQLite.

Implementa el Requisito 2 (registro histórico y comparación entre ciclos).
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from . import config


SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    duration_min INTEGER NOT NULL,
    range_start  INTEGER NOT NULL,
    range_end    INTEGER NOT NULL,
    order_mode   TEXT NOT NULL,
    solved       INTEGER DEFAULT 0,
    correct      INTEGER DEFAULT 0,
    finish_reason TEXT
);

CREATE TABLE IF NOT EXISTS attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL,
    puzzle_id    INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    user_moves   TEXT NOT NULL,     -- UCI separados por espacio (jugadas del usuario + rival)
    user_first   TEXT,              -- primera jugada del usuario (UCI)
    is_correct   INTEGER,           -- 1 / 0 / NULL (sin validar)
    time_spent   REAL,              -- segundos empleados en el problema
    engine_line  TEXT,              -- línea solución del motor (UCI)
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_puzzle ON attempts(puzzle_id, created_at);
"""


@dataclass
class PreviousAttempt:
    is_correct: Optional[bool]
    created_at: str
    session_id: int


class Store:
    """Fachada fina sobre SQLite. Una instancia por proceso."""

    def __init__(self, path: Path | None = None):
        self.path = str(path or config.database_path())
        self._conn = sqlite3.connect(self.path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    # --- Sesiones ----------------------------------------------------------

    def start_session(
        self, duration_min: int, range_start: int, range_end: int, order_mode: str
    ) -> int:
        cur = self._conn.execute(
            "INSERT INTO sessions (started_at, duration_min, range_start, range_end, order_mode) "
            "VALUES (?, ?, ?, ?, ?)",
            (datetime.now().isoformat(timespec="seconds"), duration_min,
             range_start, range_end, order_mode),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def finish_session(
        self, session_id: int, solved: int, correct: int, finish_reason: str
    ) -> None:
        self._conn.execute(
            "UPDATE sessions SET finished_at=?, solved=?, correct=?, finish_reason=? WHERE id=?",
            (datetime.now().isoformat(timespec="seconds"), solved, correct,
             finish_reason, session_id),
        )
        self._conn.commit()

    # --- Intentos ----------------------------------------------------------

    def record_attempt(
        self,
        session_id: int,
        puzzle_id: int,
        user_moves: str,
        user_first: str,
        time_spent: float,
    ) -> int:
        cur = self._conn.execute(
            "INSERT INTO attempts (session_id, puzzle_id, created_at, user_moves, "
            "user_first, time_spent) VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, puzzle_id, datetime.now().isoformat(timespec="seconds"),
             user_moves, user_first, time_spent),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def update_attempt_result(
        self, attempt_id: int, is_correct: Optional[bool], engine_line: str
    ) -> None:
        self._conn.execute(
            "UPDATE attempts SET is_correct=?, engine_line=? WHERE id=?",
            (None if is_correct is None else int(is_correct), engine_line, attempt_id),
        )
        self._conn.commit()

    def previous_attempt(
        self, puzzle_id: int, before_session_id: int
    ) -> Optional[PreviousAttempt]:
        """Intento más reciente del mismo problema ANTES de la sesión actual.

        Base de la comparación MEJORADO / REGRESIÓN del Requisito 2.
        """
        row = self._conn.execute(
            "SELECT is_correct, created_at, session_id FROM attempts "
            "WHERE puzzle_id=? AND session_id<? AND is_correct IS NOT NULL "
            "ORDER BY created_at DESC LIMIT 1",
            (puzzle_id, before_session_id),
        ).fetchone()
        if row is None:
            return None
        return PreviousAttempt(
            is_correct=bool(row["is_correct"]),
            created_at=row["created_at"],
            session_id=row["session_id"],
        )

    def puzzle_history(self, puzzle_id: int) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM attempts WHERE puzzle_id=? AND is_correct IS NOT NULL "
            "ORDER BY created_at ASC",
            (puzzle_id,),
        ).fetchall()

    def session_history(self) -> list[sqlite3.Row]:
        return self._conn.execute(
            "SELECT * FROM sessions WHERE finished_at IS NOT NULL ORDER BY started_at DESC"
        ).fetchall()

    def close(self) -> None:
        self._conn.close()
