#!/usr/bin/env python3
"""Punto de entrada del Entrenador del Método del Pájaro Carpintero.

Uso:
    python main.py
"""
from __future__ import annotations

import sys

from PyQt6.QtWidgets import QApplication

from app import __app_name__
from app.main_window import MainWindow


def _selfcheck() -> int:
    """Comprobación mínima para validar el binario empaquetado.

    Carga la base de posiciones desde el bundle y sale. No abre ventana.
    """
    from app.data import load_puzzles

    puzzles = load_puzzles()
    print(f"selfcheck OK: {len(puzzles)} posiciones cargadas")
    return 0 if puzzles else 1


def main() -> int:
    if "--selfcheck" in sys.argv:
        return _selfcheck()
    app = QApplication(sys.argv)
    app.setApplicationName(__app_name__)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
