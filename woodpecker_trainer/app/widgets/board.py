"""Widget de tablero de ajedrez con arrastre de piezas (Módulo de tablero).

Renderiza el FEN, orienta el tablero según el bando que mueve y captura la
jugada del usuario mediante drag & drop, emitiéndola en formato UCI.
"""
from __future__ import annotations

from typing import Dict, Optional

import chess
import chess.svg
from PyQt6.QtCore import QByteArray, QPointF, QRectF, Qt, pyqtSignal
from PyQt6.QtGui import QColor, QMouseEvent, QPainter
from PyQt6.QtSvg import QSvgRenderer
from PyQt6.QtWidgets import QMessageBox, QWidget

LIGHT = QColor("#EBECD0")
DARK = QColor("#779556")
HILITE = QColor(255, 241, 148, 160)
LASTMOVE = QColor(155, 199, 0, 120)
TARGET = QColor(20, 20, 20, 40)


class BoardWidget(QWidget):
    """Tablero interactivo. Emite ``move_made(chess.Move)`` con jugadas legales."""

    move_made = pyqtSignal(object)  # chess.Move

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumSize(360, 360)
        self._board = chess.Board()
        self._flipped = False            # True => negras abajo
        self._interactive = True
        self._user_color: Optional[chess.Color] = None
        self._last_move: Optional[chess.Move] = None

        self._drag_from: Optional[int] = None
        self._drag_pos: Optional[QPointF] = None
        self._legal_targets: set[int] = set()

        self._renderers: Dict[str, QSvgRenderer] = {}

    # --- API pública -------------------------------------------------------

    def set_board(self, board: chess.Board, user_color: Optional[chess.Color] = None):
        self._board = board
        self._user_color = user_color if user_color is not None else board.turn
        self._flipped = (self._user_color == chess.BLACK)
        self._last_move = None
        self._cancel_drag()
        self.update()

    def set_interactive(self, value: bool):
        self._interactive = value
        if not value:
            self._cancel_drag()
        self.update()

    def set_last_move(self, move: Optional[chess.Move]):
        self._last_move = move
        self.update()

    # --- geometría ---------------------------------------------------------

    def _board_size(self) -> float:
        return float(min(self.width(), self.height()))

    def _origin(self):
        size = self._board_size()
        return (self.width() - size) / 2.0, (self.height() - size) / 2.0

    def _square_size(self) -> float:
        return self._board_size() / 8.0

    def _square_at(self, pos: QPointF) -> Optional[int]:
        ox, oy = self._origin()
        s = self._square_size()
        col = int((pos.x() - ox) // s)
        row = int((pos.y() - oy) // s)
        if not (0 <= col < 8 and 0 <= row < 8):
            return None
        file = col if not self._flipped else 7 - col
        rank = 7 - row if not self._flipped else row
        return chess.square(file, rank)

    def _square_rect(self, square: int) -> QRectF:
        ox, oy = self._origin()
        s = self._square_size()
        file = chess.square_file(square)
        rank = chess.square_rank(square)
        col = file if not self._flipped else 7 - file
        row = 7 - rank if not self._flipped else rank
        return QRectF(ox + col * s, oy + row * s, s, s)

    # --- pintado -----------------------------------------------------------

    def _renderer_for(self, piece: chess.Piece) -> QSvgRenderer:
        key = piece.symbol()
        if key not in self._renderers:
            svg = chess.svg.piece(piece)
            self._renderers[key] = QSvgRenderer(QByteArray(svg.encode("utf-8")))
        return self._renderers[key]

    def paintEvent(self, event):  # noqa: N802 (Qt override)
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        s = self._square_size()

        for square in chess.SQUARES:
            rect = self._square_rect(square)
            light = (chess.square_file(square) + chess.square_rank(square)) % 2 == 1
            painter.fillRect(rect, LIGHT if light else DARK)

        if self._last_move:
            for sq in (self._last_move.from_square, self._last_move.to_square):
                painter.fillRect(self._square_rect(sq), LASTMOVE)

        for sq in self._legal_targets:
            rect = self._square_rect(sq)
            r = s * 0.28
            center = rect.center()
            painter.setBrush(TARGET)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawEllipse(center, r / 2, r / 2)

        # piezas (la que se arrastra se dibuja al final, bajo el cursor)
        for square in chess.SQUARES:
            piece = self._board.piece_at(square)
            if piece is None or square == self._drag_from:
                continue
            self._renderer_for(piece).render(painter, self._square_rect(square))

        if self._drag_from is not None and self._drag_pos is not None:
            piece = self._board.piece_at(self._drag_from)
            if piece:
                rect = QRectF(self._drag_pos.x() - s / 2, self._drag_pos.y() - s / 2, s, s)
                self._renderer_for(piece).render(painter, rect)
        painter.end()

    # --- interacción -------------------------------------------------------

    def _can_pick(self, square: int) -> bool:
        if not self._interactive:
            return False
        piece = self._board.piece_at(square)
        return piece is not None and piece.color == self._board.turn

    def mousePressEvent(self, event: QMouseEvent):  # noqa: N802
        if event.button() != Qt.MouseButton.LeftButton:
            return
        square = self._square_at(QPointF(event.position()))
        if square is not None and self._can_pick(square):
            self._drag_from = square
            self._drag_pos = QPointF(event.position())
            self._legal_targets = {
                m.to_square for m in self._board.legal_moves if m.from_square == square
            }
            self.update()

    def mouseMoveEvent(self, event: QMouseEvent):  # noqa: N802
        if self._drag_from is not None:
            self._drag_pos = QPointF(event.position())
            self.update()

    def mouseReleaseEvent(self, event: QMouseEvent):  # noqa: N802
        if self._drag_from is None:
            return
        target = self._square_at(QPointF(event.position()))
        source = self._drag_from
        self._cancel_drag()
        if target is None or target == source:
            self.update()
            return
        move = self._build_move(source, target)
        if move is not None and move in self._board.legal_moves:
            self.move_made.emit(move)
        self.update()

    def _build_move(self, source: int, target: int) -> Optional[chess.Move]:
        piece = self._board.piece_at(source)
        promotion = None
        if piece and piece.piece_type == chess.PAWN and chess.square_rank(target) in (0, 7):
            promotion = self._ask_promotion()
            if promotion is None:
                return None
        return chess.Move(source, target, promotion=promotion)

    def _ask_promotion(self) -> Optional[int]:
        box = QMessageBox(self)
        box.setWindowTitle("Coronación")
        box.setText("¿A qué pieza coronas?")
        opts = {
            "Dama": chess.QUEEN,
            "Torre": chess.ROOK,
            "Alfil": chess.BISHOP,
            "Caballo": chess.KNIGHT,
        }
        buttons = {box.addButton(name, QMessageBox.ButtonRole.AcceptRole): val
                   for name, val in opts.items()}
        box.exec()
        return buttons.get(box.clickedButton())

    def _cancel_drag(self):
        self._drag_from = None
        self._drag_pos = None
        self._legal_targets = set()
