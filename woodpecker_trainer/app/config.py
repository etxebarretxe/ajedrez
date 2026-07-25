"""Configuración global y rutas de la aplicación.

Centraliza rutas de datos, umbrales del motor y parámetros por defecto para
que el resto de módulos no tengan constantes mágicas dispersas.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


# --- Rutas -----------------------------------------------------------------

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent

# Base de datos de posiciones (JSON entregado con las especificaciones).
PUZZLES_JSON = PROJECT_DIR / "data_puzzles.json"


def user_data_dir() -> Path:
    """Directorio persistente por usuario donde guardamos SQLite y el motor.

    Usa convenciones nativas de cada plataforma para no ensuciar el repo.
    """
    if sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    d = base / "PajaroCarpintero"
    d.mkdir(parents=True, exist_ok=True)
    return d


def database_path() -> Path:
    return user_data_dir() / "historial.sqlite3"


def engines_dir() -> Path:
    d = user_data_dir() / "engines"
    d.mkdir(parents=True, exist_ok=True)
    return d


# --- Umbrales del motor (ajustables) --------------------------------------

# Tolerancia (en centipeones) entre la mejor jugada del motor y la del usuario
# para considerar una jugada "correcta". Sección 5 de las especificaciones.
TOLERANCE_CP = 90

# A partir de esta ventaja (cp) para el bando que resuelve consideramos la
# posición "decisivamente ganada" y el problema resuelto.
WIN_THRESHOLD_CP = 200

# Margen alrededor de 0 para considerar que se ha "mantenido las tablas"
# (posiciones cuyo expectedResult es 1/2-1/2).
DRAW_MARGIN_CP = 60

# Profundidad / tiempo de análisis.
VALIDATION_DEPTH = 18          # análisis profundo (validación diferida)
VALIDATION_MULTIPV = 2
OPPONENT_MOVETIME_MS = 250     # respuesta rápida del rival durante la sesión

# Puntuación con la que representamos un mate en la escala de centipeones.
MATE_SCORE_CP = 100_000


# --- Valores por defecto de sesión ----------------------------------------

DEFAULT_SESSION_MINUTES = 30
DEFAULT_RANGE_START = 1
DEFAULT_RANGE_END = 222        # primer set del método Woodpecker
DEFAULT_ORDER = "secuencial"   # "secuencial" | "aleatorio"
