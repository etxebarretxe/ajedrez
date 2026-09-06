@echo off
REM ============================================================
REM  PDF Tools - lanzador para Windows
REM  Intenta abrir la app mediante un pequeno servidor local
REM  (recomendado: hace que el visor de paginas funcione mejor).
REM  Si no hay Python, abre directamente el archivo en el navegador.
REM ============================================================
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  echo Iniciando servidor local en http://localhost:8000 ...
  start "" http://localhost:8000/index.html
  py -m http.server 8000
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo Iniciando servidor local en http://localhost:8000 ...
  start "" http://localhost:8000/index.html
  python -m http.server 8000
  goto :eof
)

echo No se encontro Python. Abriendo el archivo directamente en el navegador.
echo (Todo seguira funcionando; solo puede ir algo mas lento al ver paginas.)
start "" "%~dp0index.html"
