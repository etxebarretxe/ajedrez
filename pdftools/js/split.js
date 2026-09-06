/* split.js — Separar / extraer páginas de un PDF */
const Split = (() => {
  let file = null, bytes = null, pageCount = 0;
  let dropEl, configEl, metaEl, rangesInput, rangesWrap;

  // Parsea "1-3, 5, 8-10" a un array de índices (0-based), validando límites.
  function parseRanges(text, max) {
    const result = [];
    const parts = text.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Indica al menos una página o rango.');
    for (const part of parts) {
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        let a = +m[1], b = +m[2];
        if (a > b) [a, b] = [b, a];
        for (let p = a; p <= b; p++) pushPage(p);
      } else if (/^\d+$/.test(part)) {
        pushPage(+part);
      } else {
        throw new Error(`Formato no válido: "${part}"`);
      }
    }
    function pushPage(p) {
      if (p < 1 || p > max) throw new Error(`La página ${p} está fuera de rango (1–${max}).`);
      result.push(p - 1);
    }
    return result;
  }

  async function load(files) {
    file = files[0];
    bytes = await fileToArrayBuffer(file);
    const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    pageCount = doc.getPageCount();
    metaEl.textContent = `${file.name} · ${pageCount} páginas · ${formatBytes(file.size)}`;
    dropEl.classList.add('hidden');
    configEl.classList.remove('hidden');
    rangesInput.value = `1-${pageCount}`;
  }

  function currentMode() {
    return document.querySelector('input[name="split-mode"]:checked').value;
  }

  async function run() {
    if (!bytes) return;
    const mode = currentMode();
    showSpinner('Separando…');
    try {
      const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      if (mode === 'ranges') {
        const indices = parseRanges(rangesInput.value, pageCount);
        const out = await PDFLib.PDFDocument.create();
        const pages = await out.copyPages(src, indices);
        pages.forEach(p => out.addPage(p));
        const outBytes = await out.save();
        downloadBytes(outBytes, `${baseName(file.name)}_extraido.pdf`);
        toast(`Extraídas ${indices.length} páginas.`);
      } else {
        // Una página por PDF, empaquetadas en un ZIP
        const zip = new JSZip();
        for (let i = 0; i < pageCount; i++) {
          const out = await PDFLib.PDFDocument.create();
          const [pg] = await out.copyPages(src, [i]);
          out.addPage(pg);
          const b = await out.save();
          zip.file(`${baseName(file.name)}_pag${String(i + 1).padStart(3, '0')}.pdf`, b);
        }
        const blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, `${baseName(file.name)}_paginas.zip`);
        toast(`Separadas ${pageCount} páginas en un ZIP.`);
      }
    } catch (err) {
      console.error(err);
      toast('No se pudo separar: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  function reset() {
    file = bytes = null; pageCount = 0;
    configEl.classList.add('hidden');
    dropEl.classList.remove('hidden');
  }

  function init() {
    dropEl = document.getElementById('split-drop');
    configEl = document.getElementById('split-config');
    metaEl = document.getElementById('split-meta');
    rangesInput = document.getElementById('split-ranges');
    rangesWrap = document.getElementById('split-ranges-wrap');
    setupDropzone(dropEl, document.getElementById('split-input'), load, { multiple: false });
    document.getElementById('split-run').addEventListener('click', run);
    document.getElementById('split-clear').addEventListener('click', reset);
    document.querySelectorAll('input[name="split-mode"]').forEach(r =>
      r.addEventListener('change', () => {
        rangesWrap.classList.toggle('hidden', currentMode() !== 'ranges');
      }));
  }

  return { init };
})();
