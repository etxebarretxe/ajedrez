"""Ventana principal: orquesta pantallas, motor y persistencia."""
from __future__ import annotations

from typing import List, Optional

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import QMainWindow, QStackedWidget

from . import __app_name__, config
from .data import Puzzle, build_queue, load_puzzles
from .persistence import Store
from .screens.results_screen import ResultsScreen
from .screens.session_screen import SessionScreen
from .screens.start_screen import StartScreen
from .session import Session, SessionConfig
from .workers import (
    BootstrapWorker, OpponentEngine, ValidationEngine, make_worker_thread,
)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(f"{__app_name__} · Método Woodpecker")
        self.resize(900, 780)

        self._store = Store()
        self._puzzles: List[Puzzle] = load_puzzles()
        self._active_session: Optional[Session] = None

        # motor / hilos (se crean tras el bootstrap)
        self._engine_path: Optional[str] = None
        self._opponent: Optional[OpponentEngine] = None
        self._validator: Optional[ValidationEngine] = None
        self._opp_thread = None
        self._val_thread = None

        self.stack = QStackedWidget()
        self.setCentralWidget(self.stack)

        self.start_screen = StartScreen(len(self._puzzles))
        self.session_screen = SessionScreen(self._store)
        self.results_screen = ResultsScreen()
        for w in (self.start_screen, self.session_screen, self.results_screen):
            self.stack.addWidget(w)
        self.stack.setCurrentWidget(self.start_screen)

        self.start_screen.start_requested.connect(self._on_start)
        self.session_screen.session_finished.connect(self._on_session_finished)
        self.results_screen.back_requested.connect(self._on_back_to_start)

        self._boot()

    # --- arranque del motor ------------------------------------------------

    def _boot(self):
        self._boot_worker = BootstrapWorker()
        self._boot_worker.progress.connect(
            lambda msg: self.start_screen.set_engine_ready(False, msg)
        )
        self._boot_worker.finished_ok.connect(self._on_engine_ready)
        self._boot_worker.failed.connect(
            lambda msg: self.start_screen.set_engine_ready(False, "⚠ " + msg)
        )
        self._boot_worker.start()

    def _on_engine_ready(self, path: str):
        self._engine_path = path
        self._opponent = OpponentEngine(path)
        self._validator = ValidationEngine(path)
        self._opp_thread = make_worker_thread(self._opponent)
        self._val_thread = make_worker_thread(self._validator)

        # cableado de señales entre pantalla de sesión y motores (colas de hilos)
        self.session_screen.request_opponent.connect(
            self._opponent.compute, Qt.ConnectionType.QueuedConnection
        )
        self._opponent.ready.connect(
            self.session_screen.on_opponent_ready, Qt.ConnectionType.QueuedConnection
        )
        self.session_screen.request_validation.connect(
            self._validator.validate, Qt.ConnectionType.QueuedConnection
        )
        self._validator.validated.connect(
            self._on_validated, Qt.ConnectionType.QueuedConnection
        )
        self.start_screen.set_engine_ready(
            True, f"Motor listo ✓  ({path})"
        )

    # --- ciclo de vida de la sesión ---------------------------------------

    def _on_start(self, cfg: SessionConfig):
        queue = build_queue(
            self._puzzles, cfg.range_start, cfg.range_end, cfg.order_mode
        )
        if not queue:
            self.start_screen.set_engine_ready(
                self._engine_path is not None,
                "El rango seleccionado no contiene problemas.",
            )
            return
        session_id = self._store.start_session(
            cfg.duration_min, cfg.range_start, cfg.range_end, cfg.order_mode
        )
        self._active_session = Session(cfg, queue, session_id)
        self.stack.setCurrentWidget(self.session_screen)
        self.session_screen.start_session(self._active_session)

    def _on_session_finished(self, session: Session, reason: str):
        self._store.finish_session(
            session.session_id, session.solved_count, session.correct_count, reason
        )
        self.results_screen.set_session(session, reason)
        self.stack.setCurrentWidget(self.results_screen)

    def _on_validated(self, record_index: int, result):
        session = self._active_session
        if session is None or not (0 <= record_index < len(session.records)):
            return
        rec = session.records[record_index]
        rec.validation = result
        if rec.attempt_id is not None:
            self._store.update_attempt_result(
                rec.attempt_id, result.is_correct, result.engine_line_str
            )
        # refresca la pantalla de resultados si ya está visible
        self.results_screen.mark_validated(record_index)
        # actualiza el recuento de la sesión en SQLite
        self._store.finish_session(
            session.session_id, session.solved_count, session.correct_count,
            session.finish_reason,
        )

    def _on_back_to_start(self):
        self._active_session = None
        self.stack.setCurrentWidget(self.start_screen)

    # --- cierre limpio -----------------------------------------------------

    def closeEvent(self, event):  # noqa: N802
        for worker, thread in (
            (self._opponent, self._opp_thread),
            (self._validator, self._val_thread),
        ):
            if worker is not None:
                worker.stop()
            if thread is not None:
                thread.quit()
                thread.wait(2000)
        self._store.close()
        super().closeEvent(event)
