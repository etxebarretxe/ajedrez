/* common.js — utilidades compartidas por todas las herramientas */

// Alias de librerías (cargadas como globales desde /vendor)
const PDFLib = window.PDFLib;
const pdfjsLib = window.pdfjsLib;

// Configura el worker de pdf.js. Sobre file:// el worker puede no cargar por
// CORS; pdf.js entonces recurre a un "fake worker" en el hilo principal (más
// lento pero funcional), así que la app sigue operativa con doble clic.
if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
}

/* ---------- UI helpers ---------- */
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 3000);
}

function showSpinner(text = 'Procesando…') {
  document.getElementById('spinner-text').textContent = text;
  document.getElementById('spinner').hidden = false;
}
function hideSpinner() {
  document.getElementById('spinner').hidden = true;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

/* ---------- Descarga de archivos ---------- */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function downloadBytes(bytes, filename) {
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
}

/* ---------- Lectura de PDF ---------- */
async function fileToArrayBuffer(file) {
  return await file.arrayBuffer();
}

// Quita la extensión .pdf de un nombre
function baseName(name) {
  return name.replace(/\.pdf$/i, '');
}

/* ---------- Zona de arrastre reutilizable ---------- */
// onFiles recibe un array de File (ya filtrados a PDF).
function setupDropzone(zoneEl, inputEl, onFiles, { multiple = false } = {}) {
  const handle = (fileList) => {
    let files = Array.from(fileList).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!files.length) { toast('Selecciona archivos PDF válidos.', true); return; }
    if (!multiple) files = [files[0]];
    onFiles(files);
  };

  zoneEl.addEventListener('click', (e) => {
    if (e.target.closest('label')) return; // el label ya abre el input
    inputEl.click();
  });
  inputEl.addEventListener('change', () => {
    if (inputEl.files.length) handle(inputEl.files);
    inputEl.value = '';
  });
  ['dragover', 'dragenter'].forEach(ev =>
    zoneEl.addEventListener(ev, (e) => { e.preventDefault(); zoneEl.classList.add('drag'); }));
  ['dragleave', 'dragend'].forEach(ev =>
    zoneEl.addEventListener(ev, () => zoneEl.classList.remove('drag')));
  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneEl.classList.remove('drag');
    if (e.dataTransfer.files.length) handle(e.dataTransfer.files);
  });
}

/* ---------- Render de una página a canvas con pdf.js ---------- */
// Devuelve { canvas, viewport, widthPt, heightPt, rotation }.
async function renderPageToCanvas(pdfjsDoc, pageNumber, targetWidthPx) {
  const page = await pdfjsDoc.getPage(pageNumber);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = targetWidthPx / unscaled.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return {
    canvas, viewport, scale,
    widthPt: unscaled.width,
    heightPt: unscaled.height,
    rotation: page.rotate,
  };
}

// Convierte hex (#rrggbb) a rgb pdf-lib (0..1)
function hexToRgb(hex) {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16) / 255;
  const g = parseInt(m.substring(2, 4), 16) / 255;
  const b = parseInt(m.substring(4, 6), 16) / 255;
  return PDFLib.rgb(r, g, b);
}
