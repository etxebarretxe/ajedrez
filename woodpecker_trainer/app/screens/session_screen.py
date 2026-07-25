"""Pantalla de sesión activa: tablero, temporizador y avance silencioso.

Implementa el Requisito 1 (temporizador global visible) y el Requisito 3
(sin feedback de acierto/error durante la sesión). La validación se dispara en
segundo plano vía señales hacia ``ValidationEngine``.
"""
from __future__ import annotations

import time
from typing import List, Optional

import chess
from PyQt6.QtCore import QTimer, Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QHBoxLayout, QLabel, QProgressBar, QPushButton, QVBoxLayout, QWidget,
)

from .. import config
from ..persistence import Store
from ..session import PuzzleRecord, Session
from ..widgets.board import BoardWidget


def _fmt_time(seconds: int) -> str:
    seconds = max(0, seconds)
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


class SessionScreen(QWidget):
    # señales hacia los workers y hacia la ventana principal
    request_opponent = pyqtSignal(int, str, int)         # req_id, fen, movetime
    request_validation = pyqtSignal(int, object, list)   # record_idx, puzzle, moves
    session_finished = pyqtSignal(object, str)           # Session, reason

    def __init__(self, store: Store, parent=None):
        super().__init__(parent)
        self._store = store
        self._session: Optional[Session] = None

        self._board = chess.Board()
        self._user_color = chess.WHITE
        self._current_moves: List[str] = []
        self._user_first = ""
        self._puzzle_start = 0.0
        self._waiting = False
        self._opp_req_id = 0

        self._remaining = 0
        self._per_remaining: Optional[int] = None

        self._global_timer = QTimer(self)
        self._global_timer.setInterval(1000)
        self._global_timer.timeout.connect(self._tick)

        self._status_timer = QTimer(self)
        self._status_timer.setSingleShot(True)
        self._status_timer.timeout.connect(self._advance_after_save)

        self._build_ui()

    # --- UI ----------------------------------------------------------------

    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 16, 20, 16)

        top = QHBoxLayout()
        self.progress_lbl = QLabel("Problema 0 de 0")
        self.progress_lbl.setStyleSheet("font-size: 15px; font-weight: 600;")
        self.clock_lbl = QLabel("00:00")
        self.clock_lbl.setStyleSheet(
            "font-size: 26px; font-weight: 700; font-family: monospace;"
        )
        self.per_lbl = QLabel("")
        self.per_lbl.setStyleSheet("color:#a33; font-size: 13px; font-family: monospace;")
        top.addWidget(self.progress_lbl)
        top.addStretch(1)
        top.addWidget(self.per_lbl)
        top.addSpacing(16)
        top.addWidget(QLabel("⏱"))
        top.addWidget(self.clock_lbl)
        root.addLayout(top)

        self.progress_bar = QProgressBar()
        self.progress_bar.setTextVisible(False)
        self.progress_bar.setFixedHeight(6)
        root.addWidget(self.progress_bar)

        self.turn_lbl = QLabel("")
        self.turn_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.turn_lbl.setStyleSheet("font-size: 14px; color:#444; padding:4px;")
        root.addWidget(self.turn_lbl)

        self.board = BoardWidget()
        self.board.move_made.connect(self._on_user_move)
        root.addWidget(self.board, stretch=1)

        self.status_lbl = QLabel("")
        self.status_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.status_lbl.setStyleSheet("font-size: 15px; color:#555; min-height:22px;")
        root.addWidget(self.status_lbl)

        btn_row = QHBoxLayout()
        self.undo_btn = QPushButton("↶ Deshacer")
        self.undo_btn.clicked.connect(self._undo)
        self.submit_btn = QPushButton("Guardar y siguiente  ⏭")
        self.submit_btn.setStyleSheet(
            "QPushButton { font-weight:600; background:#779556; color:white; "
            "border-radius:6px; padding:8px 16px; }"
        )
        self.submit_btn.clicked.connect(lambda: self._submit_current())
        self.end_btn = QPushButton("Terminar sesión")
        self.end_btn.clicked.connect(lambda: self._finish("manual"))
        btn_row.addWidget(self.undo_btn)
        btn_row.addStretch(1)
        btn_row.addWidget(self.end_btn)
        btn_row.addStretch(1)
        btn_row.addWidget(self.submit_btn)
        root.addLayout(btn_row)

    # --- ciclo de sesión ---------------------------------------------------

    def start_session(self, session: Session):
        self._session = session
        self._remaining = session.config.duration_min * 60
        self._global_timer.start()
        self._load_current()

    def _load_current(self):
        assert self._session is not None
        puzzle = self._session.current_puzzle
        if puzzle is None:
            self._finish("completado")
            return
        self._board = chess.Board(puzzle.fen)
        self._user_color = self._board.turn
        self._current_moves = []
        self._user_first = ""
        self._waiting = False
        self._puzzle_start = time.monotonic()
        self._per_remaining = self._session.config.per_puzzle_seconds

        self.board.set_board(self._board, self._user_color)
        self.board.set_interactive(True)
        side = "blancas" if self._user_color == chess.WHITE else "negras"
        self.progress_lbl.setText(
            f"Problema {self._session.index + 1} de {self._session.total}"
            f"   ·   #{puzzle.id}"
        )
        self.progress_bar.setMaximum(self._session.total)
        self.progress_bar.setValue(self._session.index)
        self.turn_lbl.setText(f"Juegan {side} · encuentra la secuencia ganadora")
        self.status_lbl.setText("")
        self._update_per_label()

    def _update_per_label(self):
        if self._per_remaining is not None:
            self.per_lbl.setText(f"problema: {_fmt_time(self._per_remaining)}")
        else:
            self.per_lbl.setText("")

    # --- temporizadores ----------------------------------------------------

    def _tick(self):
        self._remaining -= 1
        self.clock_lbl.setText(_fmt_time(self._remaining))
        if self._remaining <= 60:
            self.clock_lbl.setStyleSheet(
                "font-size:26px; font-weight:700; font-family:monospace; color:#c0392b;"
            )
        if self._per_remaining is not None and not self._waiting:
            self._per_remaining -= 1
            self._update_per_label()
            if self._per_remaining <= 0:
                self._submit_current(timed_out=True)
                return
        if self._remaining <= 0:
            self._finish("tiempo")

    # --- interacción con el tablero ---------------------------------------

    def _on_user_move(self, move: chess.Move):
        if self._waiting or self._session is None:
            return
        self._board.push(move)
        self._current_moves.append(move.uci())
        if not self._user_first:
            self._user_first = move.uci()
        self.board.set_board(self._board, self._user_color)
        self.board.set_last_move(move)

        if self._board.is_game_over():
            # jaque mate / ahogado: la línea termina aquí.
            self._submit_current()
            return

        # Respuesta del rival en segundo plano (silenciosa).
        self._waiting = True
        self.board.set_interactive(False)
        self.status_lbl.setText("·  ·  ·")
        self._opp_req_id += 1
        self.request_opponent.emit(
            self._opp_req_id, self._board.fen(), config.OPPONENT_MOVETIME_MS
        )

    def on_opponent_ready(self, req_id: int, uci: str):
        if req_id != self._opp_req_id or not self._waiting:
            return  # respuesta obsoleta (undo / cambio de problema)
        self._waiting = False
        if uci:
            move = chess.Move.from_uci(uci)
            if move in self._board.legal_moves:
                self._board.push(move)
                self._current_moves.append(uci)
                self.board.set_last_move(move)
        self.board.set_board(self._board, self._user_color)
        self.board.set_last_move(
            chess.Move.from_uci(self._current_moves[-1]) if self._current_moves else None
        )
        if self._board.is_game_over():
            self._submit_current()
            return
        self.board.set_interactive(True)
        self.status_lbl.setText("")

    def _undo(self):
        if self._waiting or not self._current_moves:
            return
        # Deshace la última respuesta del rival y la jugada del usuario.
        self._board.pop()
        self._current_moves.pop()
        if self._current_moves and self._board.turn != self._user_color:
            self._board.pop()
            self._current_moves.pop()
        if not self._current_moves:
            self._user_first = ""
        self.board.set_board(self._board, self._user_color)
        self.board.set_last_move(
            chess.Move.from_uci(self._current_moves[-1]) if self._current_moves else None
        )
        self.board.set_interactive(True)

    # --- guardar y avanzar -------------------------------------------------

    def _submit_current(self, timed_out: bool = False):
        if self._session is None:
            return
        self._waiting = True
        self.board.set_interactive(False)
        self._opp_req_id += 1  # invalida cualquier respuesta pendiente del rival

        puzzle = self._session.current_puzzle
        assert puzzle is not None
        time_spent = time.monotonic() - self._puzzle_start

        record = PuzzleRecord(
            puzzle=puzzle,
            full_moves_uci=list(self._current_moves),
            user_first_uci=self._user_first,
            time_spent=time_spent,
        )
        # Persistimos el intento (sin veredicto todavía) y la comparación previa.
        prev = self._store.previous_attempt(puzzle.id, self._session.session_id)
        record.previous_correct = None if prev is None else prev.is_correct
        record.attempt_id = self._store.record_attempt(
            self._session.session_id, puzzle.id,
            " ".join(self._current_moves), self._user_first, time_spent,
        )
        record_index = len(self._session.records)
        self._session.commit_record(record)

        # Validación en segundo plano (silenciosa).
        self.request_validation.emit(record_index, puzzle, list(self._current_moves))

        # Mensaje neutro: ni acierto ni error (Requisito 3).
        msg = "Tiempo agotado · respuesta guardada" if timed_out else "Respuesta guardada ✓"
        self.status_lbl.setText(msg)
        self.status_lbl.setStyleSheet("font-size:15px; color:#3a7d34; min-height:22px;")
        self._status_timer.start(650)

    def _advance_after_save(self):
        self.status_lbl.setStyleSheet("font-size:15px; color:#555; min-height:22px;")
        if self._session is None:
            return
        if self._session.is_finished():
            self._finish("completado")
        else:
            self._load_current()

    # --- fin de sesión -----------------------------------------------------

    def _finish(self, reason: str):
        if self._session is None:
            return
        self._global_timer.stop()
        self._status_timer.stop()
        self._session.finish_reason = reason
        session = self._session
        self._session = None
        self.session_finished.emit(session, reason)
