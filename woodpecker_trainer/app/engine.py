"""Módulo de motor: localiza/descarga Stockfish y expone un wrapper UCI.

Cumple la decisión de diseño «el programa incluye/descarga Stockfish solo»:
1. Usa un binario junto a la app si existe (carpeta ``engines/`` del proyecto).
2. Usa Stockfish del PATH del sistema si está instalado.
3. Si no, lo descarga de las releases oficiales y lo cachea en el dir de usuario.
"""
from __future__ import annotations

import os
import platform
import shutil
import stat
import tarfile
import zipfile
from pathlib import Path
from typing import Callable, List, Optional

import chess
import chess.engine

from . import config


# Releases oficiales de Stockfish. Archivos .tar (linux/mac) / .zip (windows)
# que contienen una carpeta con el binario dentro.
_SF_VERSION = "sf_16.1"
_SF_BASE = f"https://github.com/official-stockfish/Stockfish/releases/download/{_SF_VERSION}"


def _download_candidates() -> List[str]:
    """URLs candidatas de descarga según SO y arquitectura."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    urls: List[str] = []
    if system == "linux":
        if machine in ("x86_64", "amd64"):
            urls += [
                f"{_SF_BASE}/stockfish-ubuntu-x86-64-avx2.tar",
                f"{_SF_BASE}/stockfish-ubuntu-x86-64-sse41-popcnt.tar",
                f"{_SF_BASE}/stockfish-ubuntu-x86-64.tar",
            ]
        elif "aarch64" in machine or "arm64" in machine:
            urls += [f"{_SF_BASE}/stockfish-android-armv8.tar"]
    elif system == "windows":
        urls += [
            f"{_SF_BASE}/stockfish-windows-x86-64-avx2.zip",
            f"{_SF_BASE}/stockfish-windows-x86-64-sse41-popcnt.zip",
            f"{_SF_BASE}/stockfish-windows-x86-64.zip",
        ]
    elif system == "darwin":
        if "arm" in machine or "aarch64" in machine:
            urls += [f"{_SF_BASE}/stockfish-macos-m1-apple-silicon.tar"]
        else:
            urls += [
                f"{_SF_BASE}/stockfish-macos-x86-64-avx2.tar",
                f"{_SF_BASE}/stockfish-macos-x86-64-sse41-popcnt.tar",
            ]
    return urls


def _make_executable(path: Path) -> None:
    st = os.stat(path)
    os.chmod(path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def _find_binary_in(directory: Path) -> Optional[Path]:
    for p in sorted(directory.rglob("*")):
        name = p.name.lower()
        if not p.is_file():
            continue
        if name.startswith("stockfish") and not name.endswith((".tar", ".zip", ".txt")):
            return p
    return None


class StockfishProvider:
    """Resuelve la ruta a un binario de Stockfish, descargándolo si hace falta."""

    #: fichero donde cacheamos la ruta resuelta para no volver a buscar
    _CACHE_FILE = "stockfish_path.txt"

    def __init__(self, engines_dir: Path | None = None):
        self.engines_dir = engines_dir or config.engines_dir()

    # -- localización ------------------------------------------------------

    def _cached_path(self) -> Optional[Path]:
        cache = self.engines_dir / self._CACHE_FILE
        if cache.exists():
            p = Path(cache.read_text(encoding="utf-8").strip())
            if p.exists():
                return p
        return None

    def _bundled_path(self) -> Optional[Path]:
        # 1) binario ya extraído en el dir de motores del usuario
        found = _find_binary_in(self.engines_dir)
        if found:
            return found
        # 2) binario junto al código (engines/ del proyecto, para distribución)
        project_engines = config.PROJECT_DIR / "engines"
        if project_engines.exists():
            found = _find_binary_in(project_engines)
            if found:
                return found
        return None

    def _system_path(self) -> Optional[Path]:
        for name in ("stockfish", "stockfish.exe"):
            found = shutil.which(name)
            if found:
                return Path(found)
        return None

    # -- descarga ----------------------------------------------------------

    def _download_and_extract(
        self, progress: Optional[Callable[[str], None]] = None
    ) -> Optional[Path]:
        import urllib.request

        def log(msg: str) -> None:
            if progress:
                progress(msg)

        for url in _download_candidates():
            archive_name = url.rsplit("/", 1)[-1]
            archive_path = self.engines_dir / archive_name
            try:
                log(f"Descargando Stockfish… ({archive_name})")
                req = urllib.request.Request(url, headers={"User-Agent": "PajaroCarpintero/1.0"})
                with urllib.request.urlopen(req, timeout=60) as resp, open(archive_path, "wb") as out:
                    shutil.copyfileobj(resp, out)
            except Exception as exc:  # noqa: BLE001 - probamos la siguiente URL
                log(f"No se pudo descargar {archive_name}: {exc}")
                continue

            try:
                log("Extrayendo…")
                extract_dir = self.engines_dir / archive_name.rsplit(".", 1)[0]
                extract_dir.mkdir(exist_ok=True)
                if archive_name.endswith(".zip"):
                    with zipfile.ZipFile(archive_path) as zf:
                        zf.extractall(extract_dir)
                else:
                    with tarfile.open(archive_path) as tf:
                        tf.extractall(extract_dir)
            except Exception as exc:  # noqa: BLE001
                log(f"Fallo al extraer {archive_name}: {exc}")
                continue
            finally:
                archive_path.unlink(missing_ok=True)

            binary = _find_binary_in(extract_dir)
            if binary:
                _make_executable(binary)
                return binary
        return None

    # -- API pública -------------------------------------------------------

    def resolve(self, progress: Optional[Callable[[str], None]] = None) -> Path:
        """Devuelve la ruta a un binario de Stockfish, descargándolo si falta.

        Lanza ``RuntimeError`` si no se encuentra ni se puede descargar.
        """
        for finder in (self._cached_path, self._bundled_path, self._system_path):
            p = finder()
            if p:
                self._save_cache(p)
                return p

        p = self._download_and_extract(progress)
        if p:
            self._save_cache(p)
            return p

        raise RuntimeError(
            "No se encontró Stockfish y no se pudo descargar automáticamente.\n"
            "Instálalo (p. ej. 'apt install stockfish' o desde stockfishchess.org) "
            "o copia el binario en la carpeta 'engines/' del proyecto."
        )

    def _save_cache(self, path: Path) -> None:
        (self.engines_dir / self._CACHE_FILE).write_text(str(path), encoding="utf-8")


# --- Evaluación ------------------------------------------------------------


def score_to_cp(score: chess.engine.PovScore, pov_color: chess.Color) -> int:
    """Convierte una PovScore a centipeones desde el punto de vista dado.

    Los mates se mapean a un valor grande proporcional a la distancia.
    """
    pov = score.pov(pov_color)
    if pov.is_mate():
        mate = pov.mate()
        if mate is None:
            return 0
        sign = 1 if mate > 0 else -1
        return sign * (config.MATE_SCORE_CP - abs(mate))
    cp = pov.score()
    return 0 if cp is None else cp


class EngineManager:
    """Wrapper sencillo sobre ``chess.engine.SimpleEngine`` (UCI).

    No es seguro para uso concurrente: usa una instancia por hilo/tarea.
    """

    def __init__(self, binary_path: Path, threads: int = 1, hash_mb: int = 128):
        self.binary_path = str(binary_path)
        self._engine = chess.engine.SimpleEngine.popen_uci(self.binary_path)
        try:
            self._engine.configure({"Threads": threads, "Hash": hash_mb})
        except Exception:  # noqa: BLE001 - opciones no soportadas: seguimos
            pass

    def best_move(self, board: chess.Board, movetime_ms: int) -> Optional[chess.Move]:
        """Mejor jugada rápida (usado para el rival durante la sesión)."""
        if board.is_game_over():
            return None
        limit = chess.engine.Limit(time=movetime_ms / 1000.0)
        result = self._engine.play(board, limit)
        return result.move

    def evaluate(
        self, board: chess.Board, depth: int, multipv: int = 1
    ) -> List[dict]:
        """Analiza y devuelve las líneas (multipv) como lista de dicts info."""
        if board.is_game_over():
            return []
        limit = chess.engine.Limit(depth=depth)
        info = self._engine.analyse(board, limit, multipv=multipv)
        return info if isinstance(info, list) else [info]

    def eval_cp(self, board: chess.Board, depth: int, pov_color: chess.Color) -> int:
        """Evaluación en centipeones de la posición desde ``pov_color``."""
        info = self.evaluate(board, depth, multipv=1)
        if not info:
            # posición terminal: mate a favor de quien acaba de mover, o tablas
            if board.is_checkmate():
                loser = board.turn
                sign = -1 if loser == pov_color else 1
                return sign * config.MATE_SCORE_CP
            return 0
        return score_to_cp(info[0]["score"], pov_color)

    def close(self) -> None:
        try:
            self._engine.quit()
        except Exception:  # noqa: BLE001
            pass
