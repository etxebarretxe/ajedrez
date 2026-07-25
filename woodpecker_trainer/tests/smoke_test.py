"""Pruebas de humo: lógica de datos, persistencia, motor y validador.

Ejecutar con Stockfish disponible en PATH (o /usr/games en PATH):
    PATH=$PATH:/usr/games python tests/smoke_test.py
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chess  # noqa: E402

from app import config  # noqa: E402
from app.data import build_queue, load_puzzles  # noqa: E402
from app.engine import EngineManager, StockfishProvider, score_to_cp  # noqa: E402
from app.persistence import Store  # noqa: E402
from app.validator import validate_line  # noqa: E402


def test_data():
    puzzles = load_puzzles()
    assert len(puzzles) == 1128, len(puzzles)
    q = build_queue(puzzles, 1, 10, "secuencial")
    assert [p.id for p in q] == list(range(1, 11))
    q2 = build_queue(puzzles, 1, 50, "aleatorio", seed=1)
    assert sorted(p.id for p in q2) == list(range(1, 51))
    assert puzzles[0].goal in ("win_white", "win_black", "draw")
    print("✓ data: 1128 posiciones, cola y orden OK")


def test_persistence():
    tmp = Path(tempfile.mkdtemp()) / "t.sqlite3"
    store = Store(tmp)
    s1 = store.start_session(30, 1, 10, "secuencial")
    a1 = store.record_attempt(s1, 5, "e2e4 e7e5", "e2e4", 3.2)
    store.update_attempt_result(a1, True, "e2e4 e7e5")
    store.finish_session(s1, 1, 1, "manual")

    s2 = store.start_session(30, 1, 10, "secuencial")
    prev = store.previous_attempt(5, s2)
    assert prev is not None and prev.is_correct is True
    assert store.previous_attempt(999, s2) is None
    store.close()
    print("✓ persistence: intentos, sesiones y comparación previa OK")


def test_engine_and_validator():
    path = StockfishProvider().resolve()
    engine = EngineManager(path)
    puzzles = load_puzzles()
    puzzle = puzzles[0]  # #1, negras ganan (0-1)

    board = chess.Board(puzzle.fen)
    info = engine.evaluate(board, 14, 1)
    assert info, "el motor no devolvió análisis"
    cp = score_to_cp(info[0]["score"], board.turn)
    print(f"    eval inicial #1 (pov {'w' if board.turn else 'b'}): {cp} cp")

    # Línea "buena": la PV del propio motor -> debe validarse como CORRECTA.
    pv = info[0]["pv"][:6]
    good_line = [m.uci() for m in pv]
    res_good = validate_line(puzzle, good_line, engine)
    print(f"    línea del motor -> correcto={res_good.is_correct} ({res_good.reason})")
    assert res_good.is_correct, "la PV del motor debería ser correcta"

    # Línea "mala": una jugada legal cualquiera que no sea la mejor.
    bad = next(m for m in board.legal_moves if m != pv[0])
    res_bad = validate_line(puzzle, [bad.uci()], engine)
    print(f"    jugada floja {bad.uci()} -> correcto={res_bad.is_correct}")

    assert res_good.engine_line_san, "debería generarse una línea solución"
    engine.close()
    print("✓ engine + validator: evaluación, validación de secuencia y solución OK")


if __name__ == "__main__":
    test_data()
    test_persistence()
    test_engine_and_validator()
    print("\nTODAS LAS PRUEBAS DE HUMO OK")
