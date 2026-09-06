/* organize.js — Reordenar, rotar y eliminar páginas */
const Organize = (() => {
  let file = null, bytes = null, pdfjsDoc = null;
  let pages = [];       // [{ origIndex, rotation, deleted }]
  let dropEl, toolbarEl, gridEl, metaEl;

  async function load(files) {
    file = files[0];
    bytes = await fileToArrayBuffer(file);
    showSpinner('Cargando páginas…');
    try {
      // pdf.js consume el buffer; usamos una copia para no invalidar `bytes`.
      pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      pages = [];
      for (let i = 0; i < pdfjsDoc.numPages; i++) {
        pages.push({ origIndex: i, rotation: 0, deleted: false });
      }
      metaEl.textContent = `${file.name} · ${pdfjsDoc.numPages} páginas`;
      dropEl.classList.add('hidden');
      toolbarEl.classList.remove('hidden');
      await renderGrid();
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir el PDF: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  async function renderGrid() {
    gridEl.innerHTML = '';
    for (let pos = 0; pos < pages.length; pos++) {
      const state = pages[pos];
      const card = document.createElement('div');
      card.className = 'thumb' + (state.deleted ? ' deleted' : '');
      card.draggable = true;
      card.dataset.pos = pos;

      const { canvas } = await renderPageToCanvas(pdfjsDoc, state.origIndex + 1, 150);
      canvas.style.transform = `rotate(${state.rotation}deg)`;
      card.appendChild(canvas);

      const pnum = document.createElement('span');
      pnum.className = 'pnum';
      pnum.textContent = `Pág. ${state.origIndex + 1}`;
      card.appendChild(pnum);

      const actions = document.createElement('div');
      actions.className = 'thumb-actions';
      actions.innerHTML = `
        <button data-act="rot" title="Rotar 90°">⟳</button>
        <button data-act="del" title="${state.deleted ? 'Restaurar' : 'Eliminar'}">${state.deleted ? '↺' : '🗑'}</button>`;
      actions.querySelector('[data-act="rot"]').addEventListener('click', (e) => {
        e.stopPropagation();
        state.rotation = (state.rotation + 90) % 360;
        renderGrid();
      });
      actions.querySelector('[data-act="del"]').addEventListener('click', (e) => {
        e.stopPropagation();
        state.deleted = !state.deleted;
        renderGrid();
      });
      card.appendChild(actions);
      addDragHandlers(card);
      gridEl.appendChild(card);
    }
  }

  let dragPos = null;
  function addDragHandlers(card) {
    card.addEventListener('dragstart', () => { dragPos = +card.dataset.pos; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); clearTargets(); });
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-target'); });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = +card.dataset.pos;
      if (dragPos === null || dragPos === target) return;
      const [moved] = pages.splice(dragPos, 1);
      pages.splice(target, 0, moved);
      dragPos = null;
      renderGrid();
    });
  }
  function clearTargets() {
    document.querySelectorAll('.thumb.drop-target').forEach(el => el.classList.remove('drop-target'));
  }

  async function run() {
    const kept = pages.filter(p => !p.deleted);
    if (!kept.length) { toast('No queda ninguna página.', true); return; }
    showSpinner('Guardando…');
    try {
      const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const out = await PDFLib.PDFDocument.create();
      const copied = await out.copyPages(src, kept.map(p => p.origIndex));
      copied.forEach((page, i) => {
        const base = page.getRotation().angle || 0;
        const total = (base + kept[i].rotation) % 360;
        page.setRotation(PDFLib.degrees(total));
        out.addPage(page);
      });
      const outBytes = await out.save();
      downloadBytes(outBytes, `${baseName(file.name)}_organizado.pdf`);
      toast('PDF guardado y descargado.');
    } catch (err) {
      console.error(err);
      toast('No se pudo guardar: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  function reset() {
    file = bytes = pdfjsDoc = null; pages = [];
    gridEl.innerHTML = '';
    toolbarEl.classList.add('hidden');
    dropEl.classList.remove('hidden');
  }

  function init() {
    dropEl = document.getElementById('organize-drop');
    toolbarEl = document.getElementById('organize-toolbar');
    gridEl = document.getElementById('organize-grid');
    metaEl = document.getElementById('organize-meta');
    setupDropzone(dropEl, document.getElementById('organize-input'), load, { multiple: false });
    document.getElementById('organize-run').addEventListener('click', run);
    document.getElementById('organize-reset').addEventListener('click', reset);
  }

  return { init };
})();
