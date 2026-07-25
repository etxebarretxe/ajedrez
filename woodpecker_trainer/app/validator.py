"""Validación de soluciones mediante el motor (Requisito 4).

Decisión de diseño: se valida «la secuencia completa hasta ganar». No basta
con la primera jugada: se comprueba que cada jugada del usuario mantiene la
ventaja ganadora (dentro de la tolerancia) y que la línea llega al resultado
esperado (ganar / mantener tablas).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import chess

from . import config
from .data import Puzzle
from .engine import EngineManager, score_to_cp


@dataclass
class ValidationResult:
    is_correct: bool
    reason: str
    fail_ply: Optional[int]                 # ply del usuario que falló (si aplica)
    engine_line_uci: List[str] = field(default_factory=list)
    engine_line_san: List[str] = field(default_factory=list)

    @property
    def engine_line_str(self) -> str:
        return " ".join(self.engine_line_uci)


def _goal_met(board: chess.Board, puzzle: Puzzle, engine: EngineManager) -> bool:
    """¿La posición final cumple el objetivo del problema?"""
    user_color = chess.WHITE if puzzle.side_to_move == "w" else chess.BLACK

    if board.is_checkmate():
        loser = board.turn
        # El objetivo de ganar se cumple si el que recibe mate es el rival.
        if puzzle.goal in ("win_white", "win_black"):
            return loser != user_color
        return False  # mate cuando el objetivo eran tablas => no cumplido

    if board.is_stalemate() or board.is_insufficient_material() or \
            board.can_claim_threefold_repetition():
        return puzzle.goal == "draw"

    final_cp = engine.eval_cp(board, config.VALIDATION_DEPTH, user_color)
    if puzzle.goal == "draw":
        return abs(final_cp) <= config.DRAW_MARGIN_CP
    # win_white / win_black: el bando que resuelve debe estar decisivamente mejor
    return final_cp >= config.WIN_THRESHOLD_CP


def validate_line(
    puzzle: Puzzle, full_moves_uci: List[str], engine: EngineManager
) -> ValidationResult:
    """Valida la línea jugada por el usuario contra el criterio del motor.

    ``full_moves_uci`` es la secuencia completa jugada durante la sesión
    (jugadas del usuario y respuestas del rival, alternadas). El usuario mueve
    en los plies pares (0, 2, 4…) por ser el bando que resuelve.
    """
    board = chess.Board(puzzle.fen)
    user_color = board.turn

    engine_line = _solution_line(puzzle, engine)

    if not full_moves_uci:
        return ValidationResult(
            is_correct=False,
            reason="Sin respuesta: el problema no llegó a resolverse.",
            fail_ply=0,
            engine_line_uci=[m.uci() for m in engine_line],
            engine_line_san=_line_to_san(puzzle.fen, engine_line),
        )

    for ply, uci in enumerate(full_moves_uci):
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            return ValidationResult(False, f"Jugada ilegible: {uci}", ply,
                                    [m.uci() for m in engine_line],
                                    _line_to_san(puzzle.fen, engine_line))
        if move not in board.legal_moves:
            return ValidationResult(False, f"Jugada ilegal en el ply {ply}: {uci}",
                                    ply, [m.uci() for m in engine_line],
                                    _line_to_san(puzzle.fen, engine_line))

        if board.turn == user_color:
            # Comparamos la jugada del usuario con la mejor del motor.
            info = engine.evaluate(board, config.VALIDATION_DEPTH,
                                   config.VALIDATION_MULTIPV)
            best_cp = score_to_cp(info[0]["score"], user_color) if info else 0
            board.push(move)
            after_cp = engine.eval_cp(board, config.VALIDATION_DEPTH, user_color)
            if best_cp - after_cp > config.TOLERANCE_CP:
                return ValidationResult(
                    is_correct=False,
                    reason=(f"La jugada {uci} pierde ventaja "
                            f"({best_cp - after_cp} cp por debajo de la mejor)."),
                    fail_ply=ply,
                    engine_line_uci=[m.uci() for m in engine_line],
                    engine_line_san=_line_to_san(puzzle.fen, engine_line),
                )
        else:
            board.push(move)

    if _goal_met(board, puzzle, engine):
        return ValidationResult(
            is_correct=True,
            reason="Secuencia correcta: se alcanza el resultado esperado.",
            fail_ply=None,
            engine_line_uci=[m.uci() for m in engine_line],
            engine_line_san=_line_to_san(puzzle.fen, engine_line),
        )
    return ValidationResult(
        is_correct=False,
        reason="Las jugadas son razonables pero la línea no llega a "
               "materializar el resultado esperado.",
        fail_ply=None,
        engine_line_uci=[m.uci() for m in engine_line],
        engine_line_san=_line_to_san(puzzle.fen, engine_line),
    )


def _solution_line(
    puzzle: Puzzle, engine: EngineManager, max_plies: int = 12
) -> List[chess.Move]:
    """Genera la línea solución principal del motor desde el FEN inicial."""
    board = chess.Board(puzzle.fen)
    user_color = board.turn
    moves: List[chess.Move] = []
    for _ in range(max_plies):
        if board.is_game_over():
            break
        info = engine.evaluate(board, config.VALIDATION_DEPTH, 1)
        if not info:
            break
        pv = info[0].get("pv")
        if pv:
            move = pv[0]
        else:
            move = engine.best_move(board, config.OPPONENT_MOVETIME_MS)
        if move is None:
            break
        moves.append(move)
        board.push(move)
        # Cortamos cuando la ventaja ya es decisiva para el bando que resuelve.
        cp = engine.eval_cp(board, config.VALIDATION_DEPTH, user_color)
        if puzzle.goal != "draw" and cp >= config.MATE_SCORE_CP - 50:
            break
    return moves


def _line_to_san(fen: str, moves: List[chess.Move]) -> List[str]:
    board = chess.Board(fen)
    san: List[str] = []
    for m in moves:
        if m not in board.legal_moves:
            break
        san.append(board.san(m))
        board.push(m)
    return san
