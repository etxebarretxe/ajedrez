"""Prueba de humo de la interfaz (offscreen): construcción y render sin errores.

    QT_QPA_PLATFORM=offscreen PATH=$PATH:/usr/games python tests/gui_smoke.py
"""
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chess  # noqa: E402
from PyQt6.QtWidgets import QApplication  # noqa: E402

from app.data import load_puzzles  # noqa: E402
from app.persistence import Store  # noqa: E402
from app.session import PuzzleRecord, Session, SessionConfig  # noqa: E402
from app.validator import ValidationResult  # noqa: E402
from app.screens.start_screen import StartScreen  # noqa: E402
from app.screens.session_screen import SessionScreen  # noqa: E402
from app.screens.results_screen import ResultsScreen  # noqa: E402
from app.widgets.board import BoardWidget  # noqa: E402
from app.main_window import MainWindow  # noqa: E402


def main():
    app = QApplication(sys.argv)
    puzzles = load_puzzles()

    # --- BoardWidget: render de una posición ------------------------------
    bw = BoardWidget()
    bw.resize(400, 400)
    b = chess.Board(puzzles[0].fen)
    bw.set_board(b, b.turn)
    pm = bw.grab()
    assert not pm.isNull(), "el tablero no renderizó"
    print("✓ BoardWidget renderiza")

    # --- StartScreen ------------------------------------------------------
    ss = StartScreen(len(puzzles))
    ss.set_engine_ready(True, "Motor listo")
    assert ss.start_btn.isEnabled()
    ss.resize(600, 700)
    assert not ss.grab().isNull()
    print("✓ StartScreen construye y habilita 'Empezar'")

    # --- SessionScreen: simular una jugada del usuario --------------------
    tmp = Path(tempfile.mkdtemp()) / "t.sqlite3"
    store = Store(tmp)
    sid = store.start_session(30, 1, 3, "secuencial")
    session = Session(SessionConfig(30, 1, 3, "secuencial"), puzzles[:3], sid)
    sess_screen = SessionScreen(store)
    sess_screen.resize(600, 800)
    sess_screen.start_session(session)
    legal = next(iter(sess_screen._board.legal_moves))
    sess_screen._on_user_move(legal)
    assert sess_screen._current_moves == [legal.uci()]
    assert sess_screen._waiting is True  # esperando respuesta del rival
    print("✓ SessionScreen: temporizador, jugada registrada y espera al rival")

    # --- ResultsScreen: soluciones diferidas + comparación ----------------
    # línea legal para la posición #1 (negras juegan): dos primeras jugadas legales
    b0 = chess.Board(puzzles[0].fen)
    m0 = next(iter(b0.legal_moves)); b0.push(m0)
    m1 = next(iter(b0.legal_moves))
    rec = PuzzleRecord(puzzle=puzzles[0], full_moves_uci=[m0.uci()],
                       user_first_uci=m0.uci())
    rec.previous_correct = False
    session2 = Session(SessionConfig(30, 1, 1, "secuencial"), puzzles[:1], sid)
    session2.records.append(rec)
    rs = ResultsScreen()
    rs.resize(800, 700)
    rs.set_session(session2, "completado")
    rec.validation = ValidationResult(
        is_correct=True, reason="ok", fail_ply=None,
        engine_line_uci=[m0.uci(), m1.uci()], engine_line_san=["m0", "m1"],
    )
    rs.mark_validated(0)
    assert "MEJORADO" in rec.transition
    rs._go(1)  # navegar la línea solución
    assert not rs.grab().isNull()
    print("✓ ResultsScreen: soluciones diferidas, navegación y transición MEJORADO")

    # --- MainWindow: bootstrap real del motor -----------------------------
    win = MainWindow()
    win.resize(900, 780)
    deadline = time.time() + 20
    while win._engine_path is None and time.time() < deadline:
        app.processEvents()
        time.sleep(0.05)
    assert win._engine_path is not None, "el bootstrap del motor no terminó"
    assert win._opponent is not None and win._validator is not None
    print(f"✓ MainWindow: motor resuelto en {win._engine_path}")
    win.close()
    store.close()
    print("\nGUI SMOKE OK")


if __name__ == "__main__":
    main()
