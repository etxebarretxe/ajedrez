/* edit.js — Superponer texto, rectángulos y "tapar" zonas sobre el PDF.
   No modifica el texto original: dibuja una capa encima.

   Sobre la rotación: un PDF guarda cada página con una etiqueta /Rotate
   (0/90/180/270) que le dice a cualquier lector cómo mostrarla (típico en
   escaneos de impresora). Aquí renderizamos respetando esa rotación, para
   que el usuario vea la página igual que en cualquier otro visor.
   Los elementos se guardan como fracciones (0–1) de la página TAL COMO SE VE
   en pantalla (ya rotada). Al exportar, usamos las funciones de conversión
   de coordenadas de pdf.js (convertToPdfPoint), que ya conocen la rotación
   de la página, para traducir esa posición de pantalla al sistema de
   coordenadas interno del PDF que espera pdf-lib. Así no hace falta escribir
   a mano la trigonometría de cada caso (0/90/180/270). */
const Edit = (() => {
  let file = null, bytes = null, pdfjsDoc = null;
  let current = 1, renderScale = 1, canvasW = 0, canvasH = 0;
  let elements = {};   // { [pageNum]: [ {id,type,nx,ny,nw,nh,color,text,fontPt} ] }
  let selected = null; // { page, id }
  let nextId = 1;

  let dropEl, editorEl, canvasEl, overlayEl, pageWrapEl, pageInfoEl;
  let colorInput, fontSizeInput, deleteBtn;

  async function load(files) {
    file = files[0];
    bytes = await fileToArrayBuffer(file);
    showSpinner('Abriendo PDF…');
    try {
      pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      elements = {}; current = 1; selected = null;
      dropEl.classList.add('hidden');
      editorEl.classList.remove('hidden');
      await renderPage();
    } catch (err) {
      console.error(err);
      toast('No se pudo abrir el PDF: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  async function renderPage() {
    const page = await pdfjsDoc.getPage(current);
    // Usamos page.rotate (la rotación real guardada en el PDF) para que la
    // página se vea "derecha", igual que en cualquier visor normal.
    const stageW = Math.min(900, pageWrapEl.parentElement.clientWidth - 40 || 900);
    const raw = page.getViewport({ scale: 1, rotation: page.rotate });
    renderScale = stageW / raw.width;
    const viewport = page.getViewport({ scale: renderScale, rotation: page.rotate });
    canvasEl.width = Math.ceil(viewport.width);
    canvasEl.height = Math.ceil(viewport.height);
    canvasW = canvasEl.width; canvasH = canvasEl.height;
    pageWrapEl.style.width = canvasW + 'px';
    pageWrapEl.style.height = canvasH + 'px';
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasW, canvasH);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageInfoEl.textContent = `Página ${current} / ${pdfjsDoc.numPages}`;
    renderOverlay();
  }

  function renderOverlay() {
    overlayEl.innerHTML = '';
    const list = elements[current] || [];
    for (const el of list) {
      const node = document.createElement('div');
      node.className = 'el ' + (el.type === 'text' ? 'text' : 'rect');
      node.style.left = (el.nx * 100) + '%';
      node.style.top = (el.ny * 100) + '%';
      node.style.width = (el.nw * 100) + '%';
      node.style.height = (el.nh * 100) + '%';
      node.dataset.id = el.id;

      if (el.type === 'text') {
        const ta = document.createElement('textarea');
        ta.className = 'el-text';
        ta.value = el.text;
        ta.style.color = el.color;
        ta.style.fontSize = (el.fontPt * renderScale) + 'px';
        ta.addEventListener('input', () => { el.text = ta.value; });
        ta.addEventListener('mousedown', (e) => e.stopPropagation()); // permitir escribir
        ta.addEventListener('focus', () => select(el.id));
        node.appendChild(ta);
      } else {
        node.style.background = el.color;
      }

      const handle = document.createElement('div');
      handle.className = 'resize';
      node.appendChild(handle);

      if (selected && selected.id === el.id) node.classList.add('selected');

      makeDraggable(node, el, handle);
      node.addEventListener('mousedown', () => select(el.id));
      overlayEl.appendChild(node);
    }
    deleteBtn.disabled = !selected;
  }

  function select(id) {
    selected = { page: current, id };
    const el = (elements[current] || []).find(e => e.id === id);
    if (el) {
      if (el.color) colorInput.value = normalizeHex(el.color);
      if (el.type === 'text') fontSizeInput.value = Math.round(el.fontPt);
    }
    renderOverlaySelectionOnly();
  }

  function renderOverlaySelectionOnly() {
    overlayEl.querySelectorAll('.el').forEach(n =>
      n.classList.toggle('selected', selected && +n.dataset.id === selected.id));
    deleteBtn.disabled = !selected;
  }

  function makeDraggable(node, el, handle) {
    // Mover
    node.addEventListener('mousedown', (e) => {
      if (e.target === handle) return;
      if (e.target.classList.contains('el-text') && document.activeElement === e.target) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const ox = el.nx, oy = el.ny;
      const move = (ev) => {
        el.nx = clamp01(ox + (ev.clientX - startX) / canvasW);
        el.ny = clamp01(oy + (ev.clientY - startY) / canvasH);
        node.style.left = (el.nx * 100) + '%';
        node.style.top = (el.ny * 100) + '%';
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    // Redimensionar
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const ow = el.nw, oh = el.nh;
      const move = (ev) => {
        el.nw = Math.max(0.02, ow + (ev.clientX - startX) / canvasW);
        el.nh = Math.max(0.015, oh + (ev.clientY - startY) / canvasH);
        node.style.width = (el.nw * 100) + '%';
        node.style.height = (el.nh * 100) + '%';
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    // Doble clic en texto -> editar
    if (el.type === 'text') {
      node.addEventListener('dblclick', () => {
        const ta = node.querySelector('.el-text');
        if (ta) ta.focus();
      });
    }
  }

  function addElement(type) {
    const list = elements[current] || (elements[current] = []);
    const color = type === 'cover' ? '#ffffff' : colorInput.value;
    const el = {
      id: nextId++, type: type === 'cover' ? 'rect' : type,
      nx: 0.35, ny: 0.4, nw: type === 'text' ? 0.3 : 0.25, nh: type === 'text' ? 0.06 : 0.12,
      color,
      text: type === 'text' ? 'Texto' : '',
      fontPt: parseInt(fontSizeInput.value, 10) || 16,
    };
    list.push(el);
    selected = { page: current, id: el.id };
    renderOverlay();
  }

  function deleteSelected() {
    if (!selected) return;
    const list = elements[selected.page] || [];
    const i = list.findIndex(e => e.id === selected.id);
    if (i >= 0) list.splice(i, 1);
    selected = null;
    renderOverlay();
  }

  function applyColor() {
    if (!selected) return;
    const el = (elements[selected.page] || []).find(e => e.id === selected.id);
    if (el) { el.color = colorInput.value; renderOverlay(); }
  }
  function applyFontSize() {
    if (!selected) return;
    const el = (elements[selected.page] || []).find(e => e.id === selected.id);
    if (el && el.type === 'text') { el.fontPt = parseInt(fontSizeInput.value, 10) || el.fontPt; renderOverlay(); }
  }

  async function nav(delta) {
    const next = current + delta;
    if (next < 1 || next > pdfjsDoc.numPages) return;
    current = next; selected = null;
    await renderPage();
  }

  // Convierte un punto en píxeles de "pantalla" (espacio del viewport `conv`,
  // que ya incluye la rotación real de la página) al sistema de coordenadas
  // interno del PDF que usa pdf-lib.
  function toPdfPoint(conv, x, y) {
    return conv.convertToPdfPoint(x, y);
  }

  async function run() {
    if (!bytes) return;
    showSpinner('Guardando cambios…');
    try {
      const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      const pages = doc.getPages();
      for (const [pageNumStr, list] of Object.entries(elements)) {
        if (!list.length) continue;
        const pageNum = +pageNumStr;
        const page = pages[pageNum - 1];

        // Viewport propio de esta página a escala 1 (1 px = 1 punto PDF),
        // solo para convertir coordenadas — no se usa para dibujar nada.
        const pjsPage = await pdfjsDoc.getPage(pageNum);
        const conv = pjsPage.getViewport({ scale: 1, rotation: pjsPage.rotate });

        for (const el of list) {
          // Esquinas del elemento en espacio de pantalla (top-left, bottom-right)
          const x1 = el.nx * conv.width, y1 = el.ny * conv.height;
          const x2 = (el.nx + el.nw) * conv.width, y2 = (el.ny + el.nh) * conv.height;
          const [pxA, pyA] = toPdfPoint(conv, x1, y1);
          const [pxB, pyB] = toPdfPoint(conv, x2, y2);
          const x = Math.min(pxA, pxB), y = Math.min(pyA, pyB);
          const w = Math.abs(pxB - pxA), h = Math.abs(pyB - pyA);

          if (el.type === 'rect') {
            page.drawRectangle({ x, y, width: w, height: h, color: hexToRgb(el.color) });
          } else {
            const color = hexToRgb(el.color);
            const lines = (el.text || '').split('\n');
            const lineH = el.fontPt * 1.15; // en "píxeles" de `conv` (escala 1 = puntos PDF)
            lines.forEach((line, i) => {
              if (!line.length) return;
              // Punto de base de esta línea, en espacio de pantalla, convertido
              // individualmente: así cada línea cae en su sitio sin importar
              // si la página está rotada 0/90/180/270.
              const bx = x1, by = y1 + el.fontPt * 0.80 + i * lineH;
              const [px, py] = toPdfPoint(conv, bx, by);
              page.drawText(line, { x: px, y: py, size: el.fontPt, font, color });
            });
          }
        }
      }
      const outBytes = await doc.save();
      downloadBytes(outBytes, `${baseName(file.name)}_editado.pdf`);
      toast('PDF editado y descargado.');
    } catch (err) {
      console.error(err);
      toast('No se pudo guardar: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  function reset() {
    file = bytes = pdfjsDoc = null; elements = {}; selected = null;
    editorEl.classList.add('hidden');
    dropEl.classList.remove('hidden');
  }

  function init() {
    dropEl = document.getElementById('edit-drop');
    editorEl = document.getElementById('editor');
    canvasEl = document.getElementById('edit-canvas');
    overlayEl = document.getElementById('edit-overlay');
    pageWrapEl = document.getElementById('edit-page-wrap');
    pageInfoEl = document.getElementById('edit-pageinfo');
    colorInput = document.getElementById('edit-color');
    fontSizeInput = document.getElementById('edit-fontsize');
    deleteBtn = document.getElementById('edit-delete-el');

    setupDropzone(dropEl, document.getElementById('edit-input'), load, { multiple: false });
    document.getElementById('edit-add-text').addEventListener('click', () => addElement('text'));
    document.getElementById('edit-add-rect').addEventListener('click', () => addElement('rect'));
    document.getElementById('edit-add-cover').addEventListener('click', () => addElement('cover'));
    deleteBtn.addEventListener('click', deleteSelected);
    colorInput.addEventListener('input', applyColor);
    fontSizeInput.addEventListener('change', applyFontSize);
    document.getElementById('edit-prev').addEventListener('click', () => nav(-1));
    document.getElementById('edit-next').addEventListener('click', () => nav(1));
    document.getElementById('edit-run').addEventListener('click', run);
    document.getElementById('edit-reset').addEventListener('click', reset);
    // clic en zona vacía deselecciona
    overlayEl.addEventListener('mousedown', (e) => {
      if (e.target === overlayEl) { selected = null; renderOverlaySelectionOnly(); }
    });
  }

  return { init };
})();

function clamp01(v) { return Math.max(0, Math.min(0.99, v)); }
function normalizeHex(c) {
  if (/^#([0-9a-f]{6})$/i.test(c)) return c;
  return '#111111';
}
