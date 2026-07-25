@echo off
REM ===================================================================
REM  Compila el Entrenador del Pajaro Carpintero en un .exe autonomo.
REM  Requiere Python instalado SOLO en la maquina que compila.
REM  El .exe resultante se puede repartir a usuarios SIN Python.
REM ===================================================================

echo [1/4] Creando entorno virtual...
python -m venv .venv || goto :error
call .venv\Scripts\activate.bat || goto :error

echo [2/4] Instalando dependencias...
python -m pip install --upgrade pip >nul
pip install -r requirements.txt || goto :error
pip install pyinstaller || goto :error

echo [3/4] Compilando con PyInstaller...
pyinstaller --noconfirm --clean pajaro_carpintero.spec || goto :error

echo [4/4] Verificando el binario...
dist\PajaroCarpintero.exe --selfcheck || goto :error

echo.
echo ==========================================================
echo  LISTO. Tu ejecutable esta en:  dist\PajaroCarpintero.exe
echo  Puedes copiarlo y ejecutarlo en cualquier PC con Windows.
echo ==========================================================
goto :eof

:error
echo.
echo  ERROR durante la compilacion. Revisa los mensajes de arriba.
exit /b 1
