"""Pantalla de resultados: soluciones diferidas y comparación (Req. 2 y 3)."""
from __future__ import annotations

from typing import List, Optional

import chess
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QHBoxLayout, QLabel, QListWidget, QListWidgetItem, QPushButton, QSplitter,
    QTextEdit, QVBoxLayout, QWidget,
)

from ..session import PuzzleRecord, Session
from ..widgets.board import BoardWidget


TRANSITION_COLORS = {
    "MEJORADO ▲": "#2e7d32",
    "MANTENIDO ✓": "#2e7d32",
    "REGRESIÓN ▼": "#c0392b",
    "SIGUE FALLANDO": "#c0392b",
    "NUEVO": "#555",
    "SIN VALIDAR": "#999",
}


class ResultsScreen(QWidget):
    back_requested = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._session: Optional[Session] = None
        self._review_board = chess.Board()
        self._review_line: List[chess.Move] = []
        self._review_idx = 0
        self._build_ui()

    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(20, 16, 20, 16)

        self.header = QLabel("Resultados de la sesión")
        self.header.setStyleSheet("font-size: 20px; font-weight: 700;")
        root.addWidget(self.header)

        self.summary = QLabel("")
        self.summary.setStyleSheet("font-size: 13px; color:#555;")
        root.addWidget(self.summary)

        splitter = QSplitter(Qt.Orientation.Horizontal)

        self.list = QListWidget()
        self.list.setMinimumWidth(280)
        self.list.currentRowChanged.connect(self._show_detail)
        splitter.addWidget(self.list)

        right = QWidget()
        right_layout = QVBoxLayout(right)
        self.detail_title = QLabel("")
        self.detail_title.setStyleSheet("font-size: 15px; font-weight: 600;")
        right_layout.addWidget(self.detail_title)

        self.review_board = BoardWidget()
        self.review_board.set_interactive(False)
        right_layout.addWidget(self.review_board, stretch=1)

        nav = QHBoxLayout()
        self.btn_start = QPushButton("⏮")
        self.btn_prev = QPushButton("◀")
        self.move_lbl = QLabel("Posición inicial")
        self.move_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.btn_next = QPushButton("▶")
        self.btn_end = QPushButton("⏭")
        self.btn_start.clicked.connect(lambda: self._go(0))
        self.btn_prev.clicked.connect(lambda: self._go(self._review_idx - 1))
        self.btn_next.clicked.connect(lambda: self._go(self._review_idx + 1))
        self.btn_end.clicked.connect(lambda: self._go(len(self._review_line)))
        for w in (self.btn_start, self.btn_prev):
            nav.addWidget(w)
        nav.addWidget(self.move_lbl, stretch=1)
        for w in (self.btn_next, self.btn_end):
            nav.addWidget(w)
        right_layout.addLayout(nav)

        self.detail_text = QTextEdit()
        self.detail_text.setReadOnly(True)
        self.detail_text.setMaximumHeight(150)
        right_layout.addWidget(self.detail_text)

        splitter.addWidget(right)
        splitter.setStretchFactor(1, 1)
        root.addWidget(splitter, stretch=1)

        bottom = QHBoxLayout()
        self.analyzing_lbl = QLabel("")
        self.analyzing_lbl.setStyleSheet("color:#888; font-size:12px;")
        bottom.addWidget(self.analyzing_lbl)
        bottom.addStretch(1)
        back = QPushButton("Volver al inicio")
        back.clicked.connect(self.back_requested.emit)
        bottom.addWidget(back)
        root.addLayout(bottom)

    # --- carga -------------------------------------------------------------

    def set_session(self, session: Session, reason: str):
        self._session = session
        reasons = {
            "tiempo": "Se agotó el temporizador",
            "completado": "Se resolvieron todos los problemas",
            "manual": "Sesión terminada manualmente",
        }
        self.header.setText(f"Resultados · {reasons.get(reason, reason)}")
        self.list.clear()
        for i, rec in enumerate(session.records):
            item = QListWidgetItem(self._row_text(rec))
            self.list.addItem(item)
        self._refresh_summary()
        if session.records:
            self.list.setCurrentRow(0)

    def _row_text(self, rec: PuzzleRecord) -> str:
        if rec.validation is None:
            mark = "⏳"
        else:
            mark = "✅" if rec.validation.is_correct else "❌"
        return f"{mark}  #{rec.puzzle.id}   {rec.transition}"

    def mark_validated(self, record_index: int):
        """Actualiza una fila cuando llega su validación."""
        if self._session is None:
            return
        if 0 <= record_index < self.list.count():
            rec = self._session.records[record_index]
            item = self.list.item(record_index)
            item.setText(self._row_text(rec))
            if rec.validation is not None:
                item.setForeground(Qt.GlobalColor.darkGreen if rec.validation.is_correct
                                   else Qt.GlobalColor.darkRed)
        self._refresh_summary()
        if self.list.currentRow() == record_index:
            self._show_detail(record_index)

    def _refresh_summary(self):
        if self._session is None:
            return
        total = len(self._session.records)
        validated = sum(1 for r in self._session.records if r.validation is not None)
        correct = sum(1 for r in self._session.records
                      if r.validation is not None and r.validation.is_correct)
        total_time = sum(r.time_spent for r in self._session.records)
        self.summary.setText(
            f"Resueltos: {total}   ·   Aciertos: {correct}   ·   "
            f"Fallos: {validated - correct}   ·   "
            f"Tiempo total: {int(total_time // 60)} min {int(total_time % 60)} s"
        )
        if validated < total:
            self.analyzing_lbl.setText(f"Analizando con el motor… {validated}/{total}")
        else:
            self.analyzing_lbl.setText("Análisis completado ✓")

    # --- detalle -----------------------------------------------------------

    def _show_detail(self, row: int):
        if self._session is None or not (0 <= row < len(self._session.records)):
            return
        rec = self._session.records[row]
        self.detail_title.setText(f"Problema #{rec.puzzle.id}  ·  {rec.transition}")

        self._review_board = chess.Board(rec.puzzle.fen)
        user_color = self._review_board.turn
        self._review_line = []
        if rec.validation is not None:
            for uci in rec.validation.engine_line_uci:
                try:
                    self._review_line.append(chess.Move.from_uci(uci))
                except ValueError:
                    break
        self.review_board.set_board(self._review_board, user_color)
        self._go(0)

        self.detail_text.setHtml(self._detail_html(rec))

    def _detail_html(self, rec: PuzzleRecord) -> str:
        if rec.validation is None:
            return "<i>Analizando la solución con el motor…</i>"
        v = rec.validation
        verdict = ("<b style='color:#2e7d32'>CORRECTO</b>" if v.is_correct
                   else "<b style='color:#c0392b'>INCORRECTO</b>")
        user_line = self._user_line_san(rec) or "(sin respuesta)"
        sol = " ".join(v.engine_line_san) or "(no disponible)"
        prev = ("primera vez" if rec.previous_correct is None
                else ("acertado" if rec.previous_correct else "fallado"))
        return (
            f"<p>Veredicto: {verdict}<br>"
            f"<span style='color:#555'>{v.reason}</span></p>"
            f"<p><b>Tu línea:</b> {user_line}</p>"
            f"<p><b>Solución del motor:</b> {sol}</p>"
            f"<p style='color:#777'><b>Intento anterior:</b> {prev} "
            f"&nbsp;→&nbsp; <b>{rec.transition}</b></p>"
        )

    def _user_line_san(self, rec: PuzzleRecord) -> str:
        board = chess.Board(rec.puzzle.fen)
        out = []
        for uci in rec.full_moves_uci:
            try:
                move = chess.Move.from_uci(uci)
            except ValueError:
                break
            if move not in board.legal_moves:
                break
            out.append(board.san(move))
            board.push(move)
        return " ".join(out)

    # --- navegación de la línea solución ----------------------------------

    def _go(self, idx: int):
        idx = max(0, min(idx, len(self._review_line)))
        self._review_idx = idx
        # reconstruimos desde el FEN inicial de la posición mostrada
        if self._session is None or self.list.currentRow() < 0:
            return
        rec = self._session.records[self.list.currentRow()]
        board = chess.Board(rec.puzzle.fen)
        last = None
        for i in range(idx):
            move = self._review_line[i]
            if move not in board.legal_moves:
                break
            last = move
            board.push(move)
        self.review_board.set_board(board, chess.Board(rec.puzzle.fen).turn)
        self.review_board.set_last_move(last)
        if idx == 0:
            self.move_lbl.setText("Posición inicial")
        else:
            self.move_lbl.setText(f"Jugada {idx} de {len(self._review_line)}")
