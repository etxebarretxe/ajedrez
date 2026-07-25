"""Pantalla de inicio: configuración de la sesión (Requisito 1)."""
from __future__ import annotations

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import (
    QCheckBox, QComboBox, QFormLayout, QFrame, QGroupBox, QHBoxLayout, QLabel,
    QPushButton, QSpinBox, QVBoxLayout, QWidget,
)

from .. import config
from ..session import SessionConfig


class StartScreen(QWidget):
    start_requested = pyqtSignal(object)   # SessionConfig

    def __init__(self, total_puzzles: int, parent=None):
        super().__init__(parent)
        self._total = total_puzzles
        self._build_ui()

    def _build_ui(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(40, 30, 40, 30)
        root.setSpacing(18)

        title = QLabel("🪶 Entrenador del Método del Pájaro Carpintero")
        title.setStyleSheet("font-size: 24px; font-weight: 700;")
        subtitle = QLabel(
            f"Base de {self._total} posiciones tácticas · Validación por Stockfish"
        )
        subtitle.setStyleSheet("color: #666; font-size: 13px;")
        root.addWidget(title)
        root.addWidget(subtitle)

        form_box = QGroupBox("Configuración de la sesión")
        form = QFormLayout(form_box)
        form.setSpacing(12)

        self.duration = QSpinBox()
        self.duration.setRange(1, 600)
        self.duration.setValue(config.DEFAULT_SESSION_MINUTES)
        self.duration.setSuffix("  min")
        form.addRow("Duración de la sesión:", self.duration)

        range_row = QHBoxLayout()
        self.range_start = QSpinBox()
        self.range_start.setRange(1, self._total)
        self.range_start.setValue(config.DEFAULT_RANGE_START)
        self.range_end = QSpinBox()
        self.range_end.setRange(1, self._total)
        self.range_end.setValue(min(config.DEFAULT_RANGE_END, self._total))
        range_row.addWidget(QLabel("del"))
        range_row.addWidget(self.range_start)
        range_row.addWidget(QLabel("al"))
        range_row.addWidget(self.range_end)
        range_row.addStretch(1)
        all_btn = QPushButton("Todos")
        all_btn.setFlat(True)
        all_btn.clicked.connect(self._select_all)
        range_row.addWidget(all_btn)
        form.addRow("Rango de posiciones:", range_row)

        self.order = QComboBox()
        self.order.addItems(["secuencial", "aleatorio"])
        form.addRow("Orden:", self.order)

        per_row = QHBoxLayout()
        self.per_puzzle_enabled = QCheckBox("Límite por problema")
        self.per_puzzle_seconds = QSpinBox()
        self.per_puzzle_seconds.setRange(5, 3600)
        self.per_puzzle_seconds.setValue(60)
        self.per_puzzle_seconds.setSuffix("  s")
        self.per_puzzle_seconds.setEnabled(False)
        self.per_puzzle_enabled.toggled.connect(self.per_puzzle_seconds.setEnabled)
        per_row.addWidget(self.per_puzzle_enabled)
        per_row.addWidget(self.per_puzzle_seconds)
        per_row.addStretch(1)
        form.addRow("Opcional:", per_row)

        root.addWidget(form_box)

        # Estado del motor
        self.engine_status = QLabel("Preparando el motor Stockfish…")
        self.engine_status.setStyleSheet("color: #888; font-size: 12px;")
        self.engine_status.setWordWrap(True)
        line = QFrame()
        line.setFrameShape(QFrame.Shape.HLine)
        line.setStyleSheet("color: #ddd;")
        root.addWidget(line)
        root.addWidget(self.engine_status)

        root.addStretch(1)

        btn_row = QHBoxLayout()
        btn_row.addStretch(1)
        self.start_btn = QPushButton("Empezar  ▶")
        self.start_btn.setEnabled(False)
        self.start_btn.setMinimumWidth(160)
        self.start_btn.setMinimumHeight(42)
        self.start_btn.setStyleSheet(
            "QPushButton { font-size: 15px; font-weight: 600; background:#779556; "
            "color:white; border-radius:8px; } QPushButton:disabled { background:#bbb; }"
        )
        self.start_btn.clicked.connect(self._emit_start)
        btn_row.addWidget(self.start_btn)
        root.addLayout(btn_row)

    # --- estado del motor --------------------------------------------------

    def set_engine_ready(self, ready: bool, message: str):
        self.engine_status.setText(message)
        self.start_btn.setEnabled(ready)
        if ready:
            self.engine_status.setStyleSheet("color: #3a7d34; font-size: 12px;")

    # --- helpers -----------------------------------------------------------

    def _select_all(self):
        self.range_start.setValue(1)
        self.range_end.setValue(self._total)

    def _emit_start(self):
        start = self.range_start.value()
        end = self.range_end.value()
        if start > end:
            start, end = end, start
        cfg = SessionConfig(
            duration_min=self.duration.value(),
            range_start=start,
            range_end=end,
            order_mode=self.order.currentText(),
            per_puzzle_seconds=(
                self.per_puzzle_seconds.value() if self.per_puzzle_enabled.isChecked() else None
            ),
        )
        self.start_requested.emit(cfg)
