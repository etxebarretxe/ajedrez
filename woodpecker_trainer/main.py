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


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName(__app_name__)
    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
