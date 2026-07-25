# 🪶 Entrenador del Método del Pájaro Carpintero (Woodpecker Method)

Aplicación de escritorio para PC que implementa el **Método del Pájaro
Carpintero**: resolver el mismo conjunto de posiciones tácticas en ciclos
sucesivos, reduciendo el tiempo, para automatizar el reconocimiento de patrones.

Base de datos: **1.128 posiciones** (`data_puzzles.json`).
Validación por motor **Stockfish** (UCI). Stack: **Python + PyQt6 + python-chess**.

---

## Los 4 requisitos (y dónde están implementados)

| # | Requisito | Implementación |
|---|-----------|----------------|
| 1 | **Temporizador de sesión configurable** | `screens/start_screen.py` (config) y `screens/session_screen.py` (reloj global visible, cuenta atrás, opción de límite por problema) |
| 2 | **Registro histórico y comparación** | `persistence.py` (SQLite `sessions`/`attempts`) + etiquetas MEJORADO / REGRESIÓN / MANTENIDO en `session.py` y `screens/results_screen.py` |
| 3 | **Soluciones diferidas** | Durante la sesión solo se muestra «Respuesta guardada ✓» (sin verde/rojo). Todo se revela al final en `results_screen.py` |
| 4 | **Validación mediante motor** | `validator.py` valida **la secuencia completa hasta ganar**, comparando cada jugada del usuario con la mejor del motor (tolerancia en cp) |

## Decisiones de diseño acordadas

- **Stack**: Python + PyQt6 + python-chess + Stockfish.
- **Validación**: la *secuencia completa* hasta ganar, no solo la primera jugada.
- **Análisis del motor**: en segundo plano durante la sesión (silencioso),
  en un hilo dedicado (`workers.ValidationEngine`).
- **Stockfish**: el programa lo resuelve solo — usa el del sistema/PATH,
  uno junto a la app (`engines/`), o **lo descarga** de las releases oficiales
  y lo cachea en el directorio de datos del usuario (`engine.StockfishProvider`).

---

## Instalación y ejecución

```bash
cd woodpecker_trainer
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

En el primer arranque, si no encuentra Stockfish, la app lo descarga
automáticamente (necesita conexión solo esa primera vez). También puedes
instalarlo tú (`apt install stockfish`, `brew install stockfish`, o
[stockfishchess.org](https://stockfishchess.org/download/)) o copiar el binario
en una carpeta `engines/` junto al proyecto.

---

## Generar un ejecutable (.exe) sin que el usuario tenga Python

El usuario final **no necesita Python**: se distribuye un único
`PajaroCarpintero.exe`. PyInstaller no compila de forma cruzada, así que el
`.exe` de Windows se genera en Windows. Dos formas:

### Opción A — GitHub Actions (recomendada, cero setup)
El workflow `.github/workflows/build-windows.yml` compila el `.exe` en un
runner Windows real en cada push y lo publica como artefacto. Solo hay que:
1. Ir a la pestaña **Actions** del repositorio en GitHub.
2. Abrir la ejecución más reciente de *Build Windows EXE*.
3. Descargar el artefacto **PajaroCarpintero-windows** → dentro está el `.exe`.

### Opción B — Compilar en tu Windows
En la máquina Windows (esta sí necesita Python una vez), dentro de
`woodpecker_trainer/`:
```bat
build_windows.bat
```
Genera `dist\PajaroCarpintero.exe`, que ya puedes copiar y ejecutar en
cualquier PC con Windows sin Python.

> Stockfish **no** se empaqueta dentro del `.exe`: se descarga o localiza en el
> primer arranque y se cachea en `%APPDATA%\PajaroCarpintero\engines\`. Esto
> mantiene el ejecutable ligero y respeta la licencia GPL de Stockfish.

---

## Flujo de la aplicación

```
[INICIO] --configurar--> [SESIÓN ACTIVA] --(tiempo agotado / todos resueltos)-->
    [ANALIZANDO...] --> [RESULTADOS] --> [GUARDAR EN SQLITE]
```

1. **Inicio**: fijas duración, rango de posiciones y orden (secuencial/aleatorio).
2. **Sesión**: reloj global visible; arrastras las piezas; el rival responde en
   segundo plano; se guarda tu línea en silencio y se avanza. Sin feedback.
3. **Resultados**: para cada problema, tu línea, veredicto del motor, la línea
   solución navegable paso a paso, y la comparación con tu intento anterior.

---

## Arquitectura (módulos)

```
main.py                      punto de entrada
app/
  config.py                  rutas, umbrales del motor, valores por defecto
  data.py                    carga del JSON y construcción de la cola
  persistence.py             SQLite: sesiones e intentos (Requisito 2)
  engine.py                  StockfishProvider (descarga) + EngineManager (UCI)
  validator.py               validación de la secuencia completa (Requisito 4)
  session.py                 estado de la sesión, cola y comparación
  workers.py                 hilos: bootstrap, rival y validación silenciosa
  widgets/board.py           tablero con arrastre de piezas (SVG)
  screens/
    start_screen.py          configuración de sesión (Requisito 1)
    session_screen.py        tablero + temporizador + avance silencioso (Req. 1,3)
    results_screen.py        soluciones diferidas + comparación (Req. 2,3)
  main_window.py             orquestación de pantallas, motor y persistencia
```

## Umbrales del motor (ajustables en `config.py`)

- `TOLERANCE_CP = 90` — margen (centipeones) para aceptar la jugada del usuario.
- `WIN_THRESHOLD_CP = 200` — ventaja a partir de la cual la posición se da por ganada.
- `DRAW_MARGIN_CP = 60` — margen alrededor de 0 para los problemas de tablas.
- `VALIDATION_DEPTH = 18`, `VALIDATION_MULTIPV = 2`, `OPPONENT_MOVETIME_MS = 250`.

---

## Pruebas

Con Stockfish disponible (en PATH; en Debian/Ubuntu está en `/usr/games`):

```bash
PATH=$PATH:/usr/games python tests/smoke_test.py                       # lógica + motor
QT_QPA_PLATFORM=offscreen PATH=$PATH:/usr/games python tests/gui_smoke.py       # interfaz
QT_QPA_PLATFORM=offscreen PATH=$PATH:/usr/games python tests/integration_test.py # end-to-end
```
