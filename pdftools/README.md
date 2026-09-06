# PDF Tools

Una pequeña aplicación **web que funciona 100% en tu ordenador**: ningún archivo
se sube a internet. Pensada como alternativa personal a iLovePDF para las tareas
más habituales.

## Funciones

- 📎 **Unir** — combina varios PDF en uno; arrastra para reordenarlos.
- ✂️ **Separar** — extrae páginas o rangos (`1-3, 5, 8-10`) a un PDF, o separa
  cada página en su propio PDF dentro de un ZIP.
- 🗂️ **Organizar** — reordena páginas arrastrando, rótalas o elimínalas.
- 🗜️ **Comprimir** — reduce el tamaño. Dos modos:
  - *Rasterizado* (Suave / Media / Fuerte): reduce mucho los PDF con imágenes o
    escaneados; el texto deja de ser seleccionable.
  - *Solo optimizar*: reorganiza el archivo sin rasterizar; conserva el texto
    seleccionable (la reducción es menor).
- ✏️ **Editar (superponer)** — añade cajas de texto, rectángulos de color o tapa
  zonas con un recuadro blanco. No modifica el texto original: dibuja encima.

## Cómo abrirla (Windows)

**Opción sencilla:** doble clic en `iniciar.bat`. Si tienes Python instalado,
levanta un pequeño servidor local y abre el navegador; si no, abre el archivo
directamente. Ambas formas funcionan.

**Alternativa:** doble clic en `index.html`.

> Nota: al abrir con doble clic (modo `file://`), el visor de páginas usa un modo
> de compatibilidad algo más lento. Usar `iniciar.bat` con Python da la mejor
> experiencia.

## Privacidad

Todo el procesado ocurre en tu navegador, en tu equipo. Las librerías están
incluidas en la carpeta `vendor/`, así que la app funciona sin conexión a
internet.

## Limitaciones conocidas (v1)

- **No** edita el texto original del PDF (como haría Adobe Acrobat); solo permite
  superponer elementos encima.
- La compresión no alcanza el nivel de iLovePDF (que usa un motor de servidor).
  Para eso haría falta una app de escritorio con un motor tipo Ghostscript.
- Sin OCR ni conversión a Word/Excel/PowerPoint (fuera del alcance de esta v1).
- Los PDF protegidos con contraseña deben desbloquearse antes de usarlos.

## Estructura

```
pdftools/
├── index.html        # interfaz
├── iniciar.bat       # lanzador para Windows
├── css/styles.css
├── js/               # una herramienta por archivo
│   ├── common.js  merge.js  split.js  organize.js  compress.js  edit.js  app.js
└── vendor/           # librerías locales (pdf-lib, pdf.js, jszip, fontkit)
```
