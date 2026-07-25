# -*- mode: python ; coding: utf-8 -*-
"""Especificación de PyInstaller para empaquetar la app en un ejecutable único.

Genera un binario autónomo (sin necesidad de Python) que incluye la base de
posiciones. Stockfish NO se empaqueta: se descarga o localiza en tiempo de
ejecución y se cachea en el directorio de datos del usuario.

Uso:
    pyinstaller pajaro_carpintero.spec
"""

block_cipher = None


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    # La base de posiciones se empaqueta como recurso de solo lectura.
    datas=[('data_puzzles.json', '.')],
    hiddenimports=['chess', 'chess.engine', 'chess.svg'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Excluimos frameworks Qt pesados que no usamos para reducir el tamaño.
    excludes=[
        'PyQt6.QtQml', 'PyQt6.QtQuick', 'PyQt6.QtWebEngineCore',
        'PyQt6.QtWebEngineWidgets', 'PyQt6.QtNetwork', 'PyQt6.Qt3DCore',
        'PyQt6.QtMultimedia', 'PyQt6.QtBluetooth', 'PyQt6.QtPositioning',
        'tkinter', 'PyQt6.QtDBus', 'PyQt6.QtPdf',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='PajaroCarpintero',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # aplicación de ventana (sin consola)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # icon='assets/icon.ico',  # opcional: descomenta si añades un icono
)
