# PDF Tools

Una pequeña aplicación **web que funciona 100% en tu ordenador**: ningún archivo
se sube a internet. Pensada como alternativa personal a iLovePDF para las tareas
más habituales.

## Funciones

- 📎 **Unir** — combina varios PDF en uno; arrastra para reordenarlos.
- ✂️ **Separar** — con varios tramos (`1-20, 28-50, 51-90`) genera un PDF por
  tramo dentro de un ZIP; marcando "Juntar todos los tramos" los une en un solo
  PDF. También puede separar cada página en su propio PDF (ZIP). Muestra miniaturas de todas
  las páginas: haz clic en una para quitarla (o escribe el rango a mano, las
  dos vistas se mantienen sincronizadas).
- 🗂️ **Organizar** — reordena páginas arrastrando, rótalas o elimínalas. Las
  miniaturas se cargan una sola vez: mover, rotar o borrar no las recarga.
- 🗜️ **Comprimir** — reduce el tamaño. Dos modos:
  - *Rasterizado* (Suave / Media / Fuerte): reduce mucho los PDF con imágenes o
    escaneados; el texto deja de ser seleccionable.
  - *Solo optimizar*: reorganiza el archivo sin rasterizar; conserva el texto
    seleccionable (la reducción es menor).
- ✏️ **Editar (superponer)** — añade cajas de texto, rectángulos de color o tapa
  zonas con un recuadro blanco. No modifica el texto original: dibuja encima.
  Respeta la rotación real del PDF, así que las páginas escaneadas en apaisado
  (típico de impresora) se ven derechas al editar, igual que en cualquier visor.
  > Ojo: el recuadro blanco solo tapa a la vista; el texto de debajo sigue en el
  > archivo (se puede copiar, buscar o leer con una IA). Para ocultar datos de
  > verdad, usa **Tachar**.
- ⬛ **Tachar** — tachado real para datos personales. Dibujas recuadros (negros
  o blancos) arrastrando sobre la página. Al aplicar, cada página con tachados
  se convierte en imagen con los recuadros ya pintados, y lo tachado deja de
  existir en el archivo. Las páginas sin tachados se copian intactas. El PDF se
  construye desde cero, sin metadatos, y antes de descargar se comprueba que no
  se ha colado ninguna página original (si algún enlace apuntaba a una página
  tachada, se quitan los enlaces; si aun así no se puede garantizar, no se
  genera el archivo).
  - **OCR opcional solo en las páginas tachadas** (Tesseract.js, en local,
    español): les devuelve una capa de texto invisible, buscable y copiable,
    con lo que sigue visible. Si el texto está de lado o al revés (escaneos),
    prueba otras orientaciones y se queda con la mejor lectura.
  - El OCR necesita abrir la app con `iniciar.bat` (no funciona con doble clic
    en `index.html`). El tachado sí funciona de las dos formas.
- 🖼️ **Imagen a PDF** — convierte una o varias imágenes (JPG, PNG, WEBP...) en
  un PDF; arrastra para reordenarlas. Respeta la rotación EXIF de las fotos de
  móvil (si no, algunas conversiones las dejan "tumbadas"). Dos tamaños de
  página: ajustado a cada imagen, o A4 centrada.
- 🛡️ **Marca de agua** — para enviar documentación sensible (DNI, nóminas...).
  Admite PDF e imágenes (se combinan en un solo PDF). Rellenas texto,
  destinatario, motivo y fecha, eliges color, tamaño de letra, opacidad e
  inclinación, y ves la vista previa en vivo. La marca se repite en diagonal
  por toda la página y el resultado se aplana (una imagen por página), así que
  no se puede quitar con un editor de PDF. Elimina los metadatos.

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
- El OCR solo existe dentro de "Tachar" (para las páginas tachadas) y solo en
  español. Sin conversión a Word/Excel/PowerPoint.
- "Tachar" elimina solo lo que tapas: si el mismo dato aparece en otra página
  sin tachar, sigue ahí.
- Los PDF protegidos con contraseña deben desbloquearse antes de usarlos.
- "Marca de agua" no puede proteger el PDF resultante con contraseña (pdf-lib no
  cifra PDFs); si lo necesitas, aplícala después con otro programa.

## Estructura

```
pdftools/
├── index.html        # interfaz
├── iniciar.bat       # lanzador para Windows
├── css/styles.css
├── js/               # una herramienta por archivo
│   ├── common.js  merge.js  split.js  organize.js  compress.js  edit.js  redact.js  img2pdf.js  watermark.js  app.js
└── vendor/           # librerías locales (pdf-lib, pdf.js, jszip, fontkit)
    └── tesseract/    # OCR local: Tesseract.js 5.1.1, núcleo WASM y datos de español (~10 MB)
```
