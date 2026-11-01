/* organize.js — Reordenar, rotar y eliminar páginas.

   Rendimiento: las miniaturas se dibujan UNA sola vez al cargar el archivo
   (es la parte cara: pdf.js tiene que renderizar cada página). Después,
   rotar, eliminar o reordenar solo cambia el estilo o la posición de las
   tarjetas ya creadas, sin volver a dibujar nada. */
const Organize = (() => {
  let file = null, bytes = null, pdfjsDoc = null;
  let pages = [];       // [{ origIndex, rotation, deleted, card, canvas, delBtn }] en orden visual
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
      await buildGrid();
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir el PDF: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  // Construye la rejilla una vez. `buildGen` protege el caso de cargar otro
  // archivo mientras el anterior aún se estaba construyendo.
  let buildGen = 0;
  async function buildGrid() {
    const myGen = ++buildGen;
    gridEl.innerHTML = '';
    const snapshot = pages.slice();
    for (let n = 0; n < snapshot.length; n++) {
      const state = snapshot[n];
      showSpinner(`Cargando miniaturas ${n + 1}/${snapshot.length}…`);
      const { canvas } = await renderPageToCanvas(pdfjsDoc, state.origIndex + 1, 150);
      if (myGen !== buildGen) return;

      const card = document.createElement('div');
      card.className = 'thumb';
      card.draggable = true;
      card.appendChild(canvas);

      const pnum = document.createElement('span');
      pnum.className = 'pnum';
      pnum.textContent = `Pág. ${state.origIndex + 1}`;
      card.appendChild(pnum);

      const actions = document.createElement('div');
      actions.className = 'thumb-actions';
      actions.innerHTML = `
        <button data-act="rot" title="Rotar 90°">⟳</button>
        <button data-act="del"></button>`;
      const delBtn = actions.querySelector('[data-act="del"]');
      actions.querySelector('[data-act="rot"]').addEventListener('click', (e) => {
        e.stopPropagation();
        state.rotation = (state.rotation + 90) % 360;
        applyCardState(state);
      });
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.deleted = !state.deleted;
        applyCardState(state);
      });
      card.appendChild(actions);

      Object.assign(state, { card, canvas, delBtn });
      addDragHandlers(state);
      applyCardState(state);
      gridEl.appendChild(card);
    }
  }

  // Refleja el estado de una página en su tarjeta ya existente (barato).
  function applyCardState(state) {
    state.card.classList.toggle('deleted', state.deleted);
    state.canvas.style.transform = `rotate(${state.rotation}deg)`;
    state.delBtn.textContent = state.deleted ? '↺' : '🗑';
    state.delBtn.title = state.deleted ? 'Restaurar' : 'Eliminar';
  }

  let dragState = null;
  function addDragHandlers(state) {
    const card = state.card;
    card.addEventListener('dragstart', () => { dragState = state; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); clearTargets(); });
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-target'); });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragState || dragState === state) return;
      const from = pages.indexOf(dragState);
      const to = pages.indexOf(state);
      pages.splice(from, 1);
      pages.splice(to, 0, dragState);
      // Mueve solo el nodo: queda después del destino si venía de antes, antes si venía de después.
      if (from < to) card.after(dragState.card); else card.before(dragState.card);
      dragState = null;
      clearTargets();
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
    buildGen++;
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
