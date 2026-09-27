/* split.js — Separar / extraer páginas de un PDF.
   La rejilla de miniaturas y el campo de texto son dos vistas del mismo
   estado (el Set `excluded`): cambiar una actualiza la otra.

   Importante para el rendimiento: la rejilla se CONSTRUYE una sola vez por
   archivo cargado (es la parte cara: pdf.js tiene que dibujar cada página en
   un canvas). Marcar/desmarcar una página después es barato -> solo cambia
   la clase CSS y el texto del botón de esa tarjeta concreta, sin volver a
   dibujar ninguna página. Con muchas páginas, la diferencia se nota mucho. */
const Split = (() => {
  let file = null, bytes = null, pdfjsDoc = null, pageCount = 0;
  let excluded = new Set(); // índices 0-based marcados para quitar
  let thumbCards = [];      // [{ card, btn }] por índice, creadas una sola vez
  let dropEl, configEl, metaEl, rangesInput, rangesWrap, gridEl;

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

  // Comprime una lista ordenada de páginas 1-based en texto "1-3, 5, 8-10"
  function compressToRanges(nums) {
    if (!nums.length) return '';
    const parts = [];
    let start = nums[0], prev = nums[0];
    for (let k = 1; k <= nums.length; k++) {
      const n = nums[k];
      if (n === prev + 1) { prev = n; continue; }
      parts.push(start === prev ? `${start}` : `${start}-${prev}`);
      if (n !== undefined) { start = prev = n; }
    }
    return parts.join(', ');
  }

  // Actualiza el campo de texto a partir de `excluded` (no dispara su listener,
  // porque asignar .value por código no genera un evento "input").
  function syncTextFromExcluded() {
    const included = [];
    for (let i = 0; i < pageCount; i++) if (!excluded.has(i)) included.push(i + 1);
    rangesInput.value = compressToRanges(included);
  }

  async function load(files) {
    file = files[0];
    bytes = await fileToArrayBuffer(file);
    showSpinner('Cargando páginas…');
    try {
      // pdf.js consume el buffer; usamos una copia para no invalidar `bytes`,
      // que luego necesita pdf-lib intacto para copiar páginas.
      pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      pageCount = pdfjsDoc.numPages;
      excluded = new Set();
      metaEl.textContent = `${file.name} · ${pageCount} páginas · ${formatBytes(file.size)}`;
      dropEl.classList.add('hidden');
      configEl.classList.remove('hidden');
      syncTextFromExcluded();
      await buildGrid();
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir el PDF: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  // Construye la rejilla UNA VEZ: dibuja cada página y crea su tarjeta.
  // Guarda { card, btn } por índice para poder actualizarlas después sin
  // volver a renderizar. `buildGen` protege el caso (raro) de cargar un
  // archivo nuevo mientras el anterior aún se estaba construyendo.
  let buildGen = 0;
  async function buildGrid() {
    const myGen = ++buildGen;
    gridEl.innerHTML = '';
    thumbCards = [];
    for (let i = 0; i < pageCount; i++) {
      const { canvas } = await renderPageToCanvas(pdfjsDoc, i + 1, 150);
      if (myGen !== buildGen) return; // se cargó otro archivo mientras tanto

      const card = document.createElement('div');
      card.className = 'thumb';
      card.dataset.idx = i;
      card.appendChild(canvas);

      const pnum = document.createElement('span');
      pnum.className = 'pnum';
      pnum.textContent = `Pág. ${i + 1}`;
      card.appendChild(pnum);

      const actions = document.createElement('div');
      actions.className = 'thumb-actions';
      const btn = document.createElement('button');
      btn.dataset.act = 'toggle';
      actions.appendChild(btn);
      card.appendChild(actions);

      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleExcluded(i); });
      card.addEventListener('click', () => toggleExcluded(i));

      gridEl.appendChild(card);
      thumbCards[i] = { card, btn };
      applyCardState(i); // clase + texto iniciales (todas incluidas al cargar)
    }
  }

  // Refleja el estado de `excluded` en UNA tarjeta ya existente: barato,
  // no toca el canvas ni el resto de la rejilla.
  function applyCardState(i) {
    const entry = thumbCards[i];
    if (!entry) return;
    const isExcluded = excluded.has(i);
    entry.card.classList.toggle('deleted', isExcluded);
    entry.btn.textContent = isExcluded ? '↺ Restaurar' : '🗑 Quitar';
  }

  function applyAllCardStates() {
    for (let i = 0; i < pageCount; i++) applyCardState(i);
  }

  function toggleExcluded(i) {
    if (excluded.has(i)) excluded.delete(i); else excluded.add(i);
    syncTextFromExcluded();
    applyCardState(i);
  }

  // El usuario escribe en el campo de texto -> reconstruye `excluded` y
  // refresca solo el estado visual de las tarjetas (sin re-renderizarlas).
  function onRangesInput() {
    try {
      const included = new Set(parseRanges(rangesInput.value, pageCount));
      excluded = new Set();
      for (let i = 0; i < pageCount; i++) if (!included.has(i)) excluded.add(i);
      applyAllCardStates();
    } catch (e) {
      // Entrada incompleta o inválida mientras se escribe: no tocar la rejilla todavía.
    }
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
        const indices = [];
        for (let i = 0; i < pageCount; i++) if (!excluded.has(i)) indices.push(i);
        if (!indices.length) throw new Error('No queda ninguna página seleccionada.');
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
    file = bytes = pdfjsDoc = null; pageCount = 0; excluded = new Set(); thumbCards = [];
    gridEl.innerHTML = '';
    configEl.classList.add('hidden');
    dropEl.classList.remove('hidden');
  }

  function init() {
    dropEl = document.getElementById('split-drop');
    configEl = document.getElementById('split-config');
    metaEl = document.getElementById('split-meta');
    rangesInput = document.getElementById('split-ranges');
    rangesWrap = document.getElementById('split-ranges-wrap');
    gridEl = document.getElementById('split-grid');
    setupDropzone(dropEl, document.getElementById('split-input'), load, { multiple: false });
    document.getElementById('split-run').addEventListener('click', run);
    document.getElementById('split-clear').addEventListener('click', reset);
    rangesInput.addEventListener('input', onRangesInput);
    document.querySelectorAll('input[name="split-mode"]').forEach(r =>
      r.addEventListener('change', () => {
        rangesWrap.classList.toggle('hidden', currentMode() !== 'ranges');
      }));
  }

  return { init };
})();
