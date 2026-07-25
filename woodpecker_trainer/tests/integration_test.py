"""Integración end-to-end (offscreen): flujo completo con motor real.

Resuelve un problema jugando la mejor línea, deja que el rival responda en su
hilo, termina la sesión y comprueba que la validación llega y puebla resultados.

    QT_QPA_PLATFORM=offscreen PATH=$PATH:/usr/games python tests/integration_test.py
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chess  # noqa: E402
from PyQt6.QtWidgets import QApplication  # noqa: E402

from app.engine import EngineManager, StockfishProvider  # noqa: E402
from app.main_window import MainWindow  # noqa: E402
from app.session import SessionConfig  # noqa: E402


def pump(app, cond, timeout=30):
    deadline = time.time() + timeout
    while not cond() and time.time() < deadline:
        app.processEvents()
        time.sleep(0.03)
    return cond()


def main():
    app = QApplication(sys.argv)
    win = MainWindow()
    assert pump(app, lambda: win._engine_path is not None, 25), "bootstrap falló"

    helper = EngineManager(StockfishProvider().resolve())

    # Sesión de 1 problema (el #1: mate para las negras).
    win._on_start(SessionConfig(1, 1, 1, "secuencial"))
    scr = win.session_screen
    assert scr._session is not None and scr._session.total == 1

    # Jugar la mejor línea como usuario hasta el final o hasta 6 jugadas.
    for _ in range(6):
        if scr._board.is_game_over() or scr._session is None:
            break
        best = helper.best_move(scr._board, 300)
        if best is None:
            break
        scr._on_user_move(best)
        # esperar la respuesta del rival (o que termine el problema)
        pump(app, lambda: not scr._waiting, 10)

    # Si el problema no se autoterminó, forzar el guardado.
    if scr._session is not None and not scr._session.is_finished():
        scr._submit_current()

    # Esperar transición a resultados (tras el timer de "Respuesta guardada").
    assert pump(app, lambda: win.stack.currentWidget() is win.results_screen, 10), \
        "no se llegó a la pantalla de resultados"
    print("✓ flujo: sesión → guardado silencioso → resultados")

    # Esperar a que llegue la validación del hilo de análisis.
    assert pump(
        app,
        lambda: win._active_session is not None
        and win._active_session.records
        and win._active_session.records[0].validation is not None,
        30,
    ), "la validación no llegó"

    rec = win._active_session.records[0]
    print(f"✓ validación recibida: correcto={rec.validation.is_correct} "
          f"· transición={rec.transition}")
    print(f"    solución motor: {' '.join(rec.validation.engine_line_san)}")

    # Comprobar persistencia: el intento quedó con veredicto en SQLite.
    hist = win._store.puzzle_history(1)
    assert hist, "el intento no se guardó en SQLite"
    print(f"✓ persistencia: {len(hist)} intento(s) del problema #1 con veredicto")

    helper.close()
    win.close()
    print("\nINTEGRACIÓN OK")


if __name__ == "__main__":
    main()
