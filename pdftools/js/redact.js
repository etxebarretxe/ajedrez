/* redact.js — Tachado real (con OCR opcional solo en las páginas tachadas).

   Diferencia con "Editar": allí el recuadro se dibuja ENCIMA y el texto de
   debajo sigue dentro del archivo (se puede copiar, buscar, o leerlo una IA).
   Aquí, cada página con tachados se "aplana": se renderiza a imagen con los
   recuadros ya pintados y esa imagen sustituye a la página original. Lo
   tachado deja de existir en el archivo.

   - Las páginas SIN tachados se copian intactas (texto seleccionable).
   - El PDF de salida se construye desde cero: solo entran las páginas
     copiadas y las nuevas imágenes. Nada de la página original tachada
     (texto, imágenes, anotaciones, metadatos) llega al archivo final, y se
     comprueba antes de descargar (si algo se colara, no se descarga).
   - Opcional: OCR (Tesseract.js, local) SOLO sobre las páginas aplanadas,
     que añade una capa de texto invisible con lo que sigue visible. Lo
     tachado ya es negro/blanco en la imagen, así que no puede reaparecer.

   Coordenadas: igual que en edit.js, los recuadros se guardan como
   fracciones (0–1) de la página TAL COMO SE VE (ya rotada). Como la página
   nueva se crea a partir de la imagen ya rotada, no hace falta convertir
   coordenadas al sistema interno del PDF. */
const Redact = (() => {
  let file = null, bytes = null, pdfjsDoc = null;
  let current = 1, canvasW = 0, canvasH = 0;
  let boxes = {};      // { [pageNum]: [ {id,nx,ny,nw,nh} ] }
  let selected = null; // { page, id }
  let nextId = 1;
  let color = '#000000';
  let dpi = 200;

  let dropEl, editorEl, canvasEl, overlayEl, pageWrapEl, pageInfoEl, countEl;
  let deleteBtn, ocrEl, ocrHintEl, resultEl;

  const OCR_AVAILABLE = location.protocol !== 'file:';
  const MIN_CONF = 50;        // confianza mínima (0–100) para meter una palabra en la capa de texto

  /* ---------------- Carga y navegación ---------------- */

  async function load(files) {
    file = files[0];
    bytes = await fileToArrayBuffer(file);
    showSpinner('Abriendo PDF…');
    try {
      pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      boxes = {}; current = 1; selected = null;
      dropEl.classList.add('hidden');
      editorEl.classList.remove('hidden');
      resultEl.classList.add('hidden');
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
    const stageW = Math.min(900, pageWrapEl.parentElement.clientWidth - 40 || 900);
    const raw = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = stageW / raw.width;
    const viewport = page.getViewport({ scale, rotation: page.rotate });
    canvasEl.width = Math.ceil(viewport.width);
    canvasEl.height = Math.ceil(viewport.height);
    canvasW = canvasEl.width; canvasH = canvasEl.height;
    pageWrapEl.style.width = canvasW + 'px';
    pageWrapEl.style.height = canvasH + 'px';
    const ctx = canvasEl.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasW, canvasH);
    await page.render({ canvasContext: ctx, viewport }).promise;
    renderOverlay();
  }

  function updateInfo() {
    pageInfoEl.textContent = `Página ${current} / ${pdfjsDoc.numPages}`;
    const pages = redactedPages();
    countEl.textContent = pages.length
      ? `Tachados en ${pages.length === 1 ? 'la página' : 'las páginas'} ${pages.join(', ')}`
      : 'Sin tachados todavía';
  }

  function redactedPages() {
    return Object.keys(boxes).map(Number).filter(p => boxes[p].length).sort((a, b) => a - b);
  }

  async function nav(delta) {
    const next = current + delta;
    if (next < 1 || next > pdfjsDoc.numPages) return;
    current = next; selected = null;
    await renderPage();
  }

  /* ---------------- Recuadros en pantalla ---------------- */

  function renderOverlay() {
    overlayEl.innerHTML = '';
    for (const b of (boxes[current] || [])) {
      const node = document.createElement('div');
      node.className = 'el rect redact-box';
      node.style.left = (b.nx * 100) + '%';
      node.style.top = (b.ny * 100) + '%';
      node.style.width = (b.nw * 100) + '%';
      node.style.height = (b.nh * 100) + '%';
      node.style.background = color;
      node.dataset.id = b.id;
      const handle = document.createElement('div');
      handle.className = 'resize';
      node.appendChild(handle);
      if (selected && selected.id === b.id) node.classList.add('selected');
      makeDraggable(node, b, handle);
      overlayEl.appendChild(node);
    }
    deleteBtn.disabled = !selected;
    updateInfo();
  }

  function select(id) {
    selected = id == null ? null : { page: current, id };
    overlayEl.querySelectorAll('.el').forEach(n =>
      n.classList.toggle('selected', !!selected && +n.dataset.id === selected.id));
    deleteBtn.disabled = !selected;
  }

  function makeDraggable(node, b, handle) {
    node.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      select(b.id);
      if (e.target === handle) return;
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY, ox = b.nx, oy = b.ny;
      const move = (ev) => {
        b.nx = Math.max(0, Math.min(1 - b.nw, ox + (ev.clientX - startX) / canvasW));
        b.ny = Math.max(0, Math.min(1 - b.nh, oy + (ev.clientY - startY) / canvasH));
        node.style.left = (b.nx * 100) + '%';
        node.style.top = (b.ny * 100) + '%';
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      select(b.id);
      const startX = e.clientX, startY = e.clientY, ow = b.nw, oh = b.nh;
      const move = (ev) => {
        b.nw = Math.max(0.005, Math.min(1 - b.nx, ow + (ev.clientX - startX) / canvasW));
        b.nh = Math.max(0.005, Math.min(1 - b.ny, oh + (ev.clientY - startY) / canvasH));
        node.style.width = (b.nw * 100) + '%';
        node.style.height = (b.nh * 100) + '%';
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  // Arrastrar sobre una zona vacía de la página dibuja un recuadro nuevo.
  function setupDrawing() {
    overlayEl.addEventListener('mousedown', (e) => {
      if (e.target !== overlayEl || e.button !== 0) return;
      e.preventDefault();
      select(null);
      const rect = overlayEl.getBoundingClientRect();
      const sx = (e.clientX - rect.left) / rect.width;
      const sy = (e.clientY - rect.top) / rect.height;
      const ghost = document.createElement('div');
      ghost.className = 'el rect redact-box drawing';
      ghost.style.background = color;
      overlayEl.appendChild(ghost);
      let box = { nx: sx, ny: sy, nw: 0, nh: 0 };
      const move = (ev) => {
        const cx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const cy = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        box = { nx: Math.min(sx, cx), ny: Math.min(sy, cy), nw: Math.abs(cx - sx), nh: Math.abs(cy - sy) };
        ghost.style.left = (box.nx * 100) + '%';
        ghost.style.top = (box.ny * 100) + '%';
        ghost.style.width = (box.nw * 100) + '%';
        ghost.style.height = (box.nh * 100) + '%';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        ghost.remove();
        // Ignora clics sueltos (recuadros minúsculos)
        if (box.nw * canvasW < 4 || box.nh * canvasH < 4) return;
        const b = { id: nextId++, ...box };
        (boxes[current] || (boxes[current] = [])).push(b);
        selected = { page: current, id: b.id };
        renderOverlay();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function deleteSelected() {
    if (!selected) return;
    const list = boxes[selected.page] || [];
    const i = list.findIndex(b => b.id === selected.id);
    if (i >= 0) list.splice(i, 1);
    selected = null;
    renderOverlay();
  }

  function clearPage() {
    boxes[current] = [];
    selected = null;
    renderOverlay();
  }

  /* ---------------- Aplanado + OCR ---------------- */

  // Renderiza la página (ya rotada) a un canvas de `dpi` y pinta encima los
  // recuadros. Lo devuelto es la "foto" final de la página.
  async function flattenPage(pageNum, list, dpiValue, fill) {
    const page = await pdfjsDoc.getPage(pageNum);
    const scale = dpiValue / 72;
    const viewport = page.getViewport({ scale, rotation: page.rotate });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    ctx.fillStyle = fill;
    for (const b of list) {
      // Redondeo "hacia fuera" para no dejar un píxel sin tapar en los bordes.
      const x0 = Math.floor(b.nx * canvas.width), y0 = Math.floor(b.ny * canvas.height);
      const x1 = Math.ceil((b.nx + b.nw) * canvas.width), y1 = Math.ceil((b.ny + b.nh) * canvas.height);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    return { canvas, scale, widthPt: viewport.width / scale, heightPt: viewport.height / scale };
  }

  // Worker de Tesseract: se crea una vez y se reutiliza mientras la app está abierta.
  let ocrWorkerPromise = null;
  let ocrProgressCb = null;
  function getOcrWorker() {
    if (!ocrWorkerPromise) {
      const base = new URL('vendor/tesseract/', location.href).href;
      ocrWorkerPromise = Tesseract.createWorker('spa', 1, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core',
        langPath: base + 'lang',
        gzip: true,
        logger: (m) => { if (ocrProgressCb) ocrProgressCb(m); },
      }).catch(err => { ocrWorkerPromise = null; throw err; });
    }
    return ocrWorkerPromise;
  }

  // Deja solo caracteres que la fuente Helvetica estándar (WinAnsi) sabe
  // codificar; el resto se sustituye. Cubre ñ, tildes, ü, ¿, ¡, €, etc.
  const encCache = new Map();
  function sanitizeFor(font, text) {
    let out = '';
    for (const ch of text.normalize('NFKC')) {
      let ok = encCache.get(ch);
      if (ok === undefined) {
        try { font.encodeText(ch); ok = true; } catch (e) { ok = false; }
        encCache.set(ch, ok);
      }
      out += ok ? ch : '?';
    }
    return out;
  }

  // Añade la capa de texto invisible (modo de render 3, como OCRmyPDF/PDF24)
  // sobre la página nueva. Cada palabra se estira horizontalmente (Tz) para
  // ocupar su sitio, de modo que buscar/seleccionar coincida con lo visible.
  // `inv` traduce coordenadas de la imagen que leyó el OCR (que puede estar
  // girada, ver ocrPage) a píxeles de la página.
  function addTextLayer(pdfPage, font, ocrData, scale, heightPt, inv) {
    const fontKey = pdfPage.node.newFontDictionary(font.name, font.ref);
    const toPdf = (x, y) => { const [px, py] = inv(x, y); return [px / scale, heightPt - py / scale]; };
    const ops = [];
    let words = 0;
    for (const block of ocrData.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          // Se descartan palabras de confianza muy baja (suelen ser "basura":
          // bordes del recuadro, manchas, sellos).
          const lw = (line.words || []).filter(w => w.text && w.text.trim() && w.confidence >= MIN_CONF);
          if (!lw.length) continue;
          const lh = (line.bbox.y1 - line.bbox.y0) / scale;          // alto de línea en puntos
          const size = Math.max(1, lh * 0.85);
          const bl = line.baseline || {};
          const hasBl = bl.has_baseline !== false && bl.x1 > bl.x0;
          lw.forEach((w, i) => {
            const isLast = i === lw.length - 1;
            const text = sanitizeFor(font, w.text.trim() + (isLast ? '' : ' '));
            // Ancho objetivo: hasta el inicio de la palabra siguiente (incluye el espacio).
            const xEndPx = isLast ? w.bbox.x1 : lw[i + 1].bbox.x0;
            const targetW = Math.max(0.5, (xEndPx - w.bbox.x0) / scale);
            const natural = font.widthOfTextAtSize(text, size);
            const tz = natural > 0 ? Math.max(5, Math.min(500, 100 * targetW / natural)) : 100;
            // Línea base: la de Tesseract si existe; si no, borde inferior menos un 20%.
            let blPx;
            if (hasBl) {
              const xm = (w.bbox.x0 + w.bbox.x1) / 2;
              blPx = bl.y0 + (bl.y1 - bl.y0) * (xm - bl.x0) / (bl.x1 - bl.x0);
            } else {
              blPx = line.bbox.y1 - (line.bbox.y1 - line.bbox.y0) * 0.2;
            }
            // Origen, dirección de escritura y "arriba" ya en coordenadas PDF
            // (así vale también para texto que en la página va de lado).
            const [ox, oy] = toPdf(w.bbox.x0, blPx);
            const [ax, ay] = toPdf(w.bbox.x0 + 10, blPx);
            const [ux, uy] = toPdf(w.bbox.x0, blPx - 10);
            const dl = Math.hypot(ax - ox, ay - oy) || 1, ul = Math.hypot(ux - ox, uy - oy) || 1;
            ops.push(
              PDFLib.beginText(),
              PDFLib.setFontAndSize(fontKey, size),
              PDFLib.setTextRenderingMode(PDFLib.TextRenderingMode.Invisible),
              PDFLib.setCharacterSqueeze(tz),
              PDFLib.setTextMatrix((ax - ox) / dl, (ay - oy) / dl, (ux - ox) / ul, (uy - oy) / ul, ox, oy),
              PDFLib.showText(font.encodeText(text)),
              PDFLib.endText(),
            );
            words++;
          });
        }
      }
    }
    if (ops.length) {
      pdfPage.pushOperators(PDFLib.pushGraphicsState(), ...ops, PDFLib.popGraphicsState());
    }
    return words;
  }

  // Puntuación de calidad del OCR: letras de palabras "de verdad" (3+ letras,
  // confianza alta). El texto de lado o al revés da puntuaciones casi nulas.
  function ocrScore(data) {
    let score = 0;
    for (const b of data.blocks || []) for (const p of b.paragraphs || [])
      for (const l of p.lines || []) for (const w of l.words || []) {
        const letters = (w.text.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
        if (w.confidence >= 70 && letters >= 3) score += letters;
      }
    return score;
  }

  // Gira un canvas 90/180/270° (sentido horario) y devuelve el nuevo canvas
  // y la función que lleva un punto del canvas girado al original.
  function rotateCanvas(src, deg) {
    const W = src.width, H = src.height;
    const c = document.createElement('canvas');
    c.width = deg === 180 ? W : H;
    c.height = deg === 180 ? H : W;
    const ctx = c.getContext('2d');
    if (deg === 90) { ctx.translate(H, 0); ctx.rotate(Math.PI / 2); }
    else if (deg === 180) { ctx.translate(W, H); ctx.rotate(Math.PI); }
    else { ctx.translate(0, W); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(src, 0, 0);
    const inv = deg === 90 ? (x, y) => [y, H - x]
      : deg === 180 ? (x, y) => [W - x, H - y]
      : (x, y) => [W - y, x];
    return { canvas: c, inv };
  }

  // OCR de una página aplanada. Si el resultado es pobre (texto de lado o al
  // revés, típico de escaneos), prueba girando la imagen y se queda con la
  // mejor lectura. La página en sí no se gira: solo se orienta la capa de texto.
  async function ocrPage(worker, canvas, onAttempt) {
    const identity = (x, y) => [x, y];
    onAttempt(0);
    let best = { data: (await worker.recognize(canvas, {}, { blocks: true, text: false })).data, inv: identity };
    best.score = ocrScore(best.data);
    if (best.score >= 40) return best;
    for (const deg of [90, 270, 180]) {
      onAttempt(deg);
      const r = rotateCanvas(canvas, deg);
      const data = (await worker.recognize(r.canvas, {}, { blocks: true, text: false })).data;
      const score = ocrScore(data);
      r.canvas.width = r.canvas.height = 0;
      if (score > best.score * 2 + 10) best = { data, inv: r.inv, score };
      if (best.score >= 40) break;
    }
    return best;
  }

  // Cuenta los objetos /Type /Page del archivo final. Si hay más que páginas
  // reales, algo (p. ej. un enlace interno) ha arrastrado una página original
  // al copiar, y podría llevar dentro el contenido tachado.
  function countPageObjects(doc) {
    const PageName = PDFLib.PDFName.of('Page');
    const TypeName = PDFLib.PDFName.of('Type');
    let n = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFLib.PDFDict && obj.get(TypeName) === PageName) n++;
    }
    return n;
  }

  async function build({ stripAnnots, doOcr, fill, dpiValue }) {
    const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    if (stripAnnots) {
      for (const p of src.getPages()) {
        p.node.delete(PDFLib.PDFName.of('Annots'));
        p.node.delete(PDFLib.PDFName.of('B'));
      }
    }
    const total = src.getPageCount();
    const redacted = new Set(redactedPages());
    // Documento NUEVO, sin metadatos (ni autor, ni programa, ni fechas).
    const out = await PDFLib.PDFDocument.create({ updateMetadata: false });
    const font = doOcr ? await out.embedFont(PDFLib.StandardFonts.Helvetica) : null;

    const keepIdx = [];
    for (let i = 0; i < total; i++) if (!redacted.has(i + 1)) keepIdx.push(i);
    const copied = keepIdx.length ? await out.copyPages(src, keepIdx) : [];
    const copiedByIdx = new Map(keepIdx.map((idx, k) => [idx, copied[k]]));

    const done = [...redacted];
    let ocrWords = 0;
    for (let i = 0; i < total; i++) {
      const pageNum = i + 1;
      if (!redacted.has(pageNum)) { out.addPage(copiedByIdx.get(i)); continue; }
      const step = done.indexOf(pageNum) + 1;
      showSpinner(`Aplanando página ${pageNum} (${step}/${done.length})…`);
      const { canvas, scale, widthPt, heightPt } = await flattenPage(pageNum, boxes[pageNum], dpiValue, fill);
      const jpg = await out.embedJpg(dataURLToBytes(canvas.toDataURL('image/jpeg', 0.85)));
      const p = out.addPage([widthPt, heightPt]);
      p.drawImage(jpg, { x: 0, y: 0, width: widthPt, height: heightPt });
      if (doOcr) {
        showSpinner(`OCR página ${pageNum} (${step}/${done.length}): preparando…`);
        ocrProgressCb = (m) => {
          if (m.status === 'recognizing text') {
            showSpinner(`OCR página ${pageNum} (${step}/${done.length}): ${Math.round(m.progress * 100)}%`);
          } else if (m.status && /load|initializ/i.test(m.status)) {
            showSpinner(`Cargando motor OCR… (solo la primera vez)`);
          }
        };
        const worker = await getOcrWorker();
        let attempt = 0;
        ocrProgressCb = (m) => {
          if (m.status === 'recognizing text') {
            const extra = attempt ? ` (probando girada ${attempt}°)` : '';
            showSpinner(`OCR página ${pageNum} (${step}/${done.length}): ${Math.round(m.progress * 100)}%${extra}`);
          }
        };
        const best = await ocrPage(worker, canvas, (deg) => { attempt = deg; });
        ocrWords += addTextLayer(p, font, best.data, scale, heightPt, best.inv);
        ocrProgressCb = null;
      }
      canvas.width = canvas.height = 0; // libera memoria
    }
    return { out, pagesRedacted: done.length, ocrWords };
  }

  async function run() {
    if (!bytes) return;
    const pages = redactedPages();
    if (!pages.length) { toast('Dibuja al menos un recuadro de tachado.', true); return; }
    const doOcr = ocrEl.checked && OCR_AVAILABLE;
    showSpinner('Preparando…');
    try {
      const probe = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      if (probe.isEncrypted) {
        throw new Error('el PDF está protegido o cifrado. Desbloquéalo antes de tacharlo.');
      }
      const opts = { doOcr, fill: color, dpiValue: dpi };
      let res = await build({ ...opts, stripAnnots: false });
      let annotsRemoved = false;
      if (countPageObjects(res.out) !== res.out.getPageCount()) {
        // Algún enlace/anotación apuntaba a una página tachada: se rehace
        // quitando las anotaciones de todas las páginas.
        res = await build({ ...opts, stripAnnots: true });
        annotsRemoved = true;
        if (countPageObjects(res.out) !== res.out.getPageCount()) {
          throw new Error('no se pudo garantizar que el contenido tachado quedara fuera del archivo. No se ha generado el PDF.');
        }
      }
      showSpinner('Guardando…');
      const outBytes = await res.out.save({ useObjectStreams: true });
      const blob = new Blob([outBytes], { type: 'application/pdf' });
      showResult(blob, res, doOcr, annotsRemoved);
      toast('Tachado aplicado.');
    } catch (err) {
      console.error(err);
      toast('No se pudo tachar: ' + err.message, true);
    } finally {
      ocrProgressCb = null;
      hideSpinner();
    }
  }

  function showResult(blob, res, doOcr, annotsRemoved) {
    resultEl.className = 'result ok';
    resultEl.innerHTML = '';
    const p = document.createElement('p');
    const n = res.pagesRedacted;
    let html = `Tachado aplicado en <b>${n} ${n === 1 ? 'página' : 'páginas'}</b>; el resto se ha copiado intacto. `;
    html += doOcr
      ? `OCR en las páginas tachadas: <b>${res.ocrWords}</b> palabras reconocidas (texto buscable y copiable).`
      : 'Las páginas tachadas son imagen (sin texto seleccionable).';
    if (annotsRemoved) html += '<br>Se han quitado los enlaces y anotaciones del documento porque alguno apuntaba a una página tachada.';
    html += `<br>Tamaño: <b>${formatBytes(blob.size)}</b>.`;
    p.innerHTML = html;
    const dl = document.createElement('button');
    dl.className = 'btn primary';
    dl.textContent = 'Descargar PDF tachado';
    dl.style.marginTop = '10px';
    dl.addEventListener('click', () => downloadBlob(blob, `${baseName(file.name)}_tachado.pdf`));
    const tip = document.createElement('p');
    tip.className = 'hint';
    tip.style.marginTop = '10px';
    tip.textContent = 'Recuerda: solo se elimina lo que has tapado. Si el mismo dato aparece en otra página sin tachar, sigue ahí. Comprobación rápida: abre el PDF, Ctrl+A, copia y pega en el Bloc de notas.';
    resultEl.append(p, dl, tip);
    resultEl.classList.remove('hidden');
  }

  function reset() {
    file = bytes = pdfjsDoc = null; boxes = {}; selected = null;
    editorEl.classList.add('hidden');
    dropEl.classList.remove('hidden');
    resultEl.classList.add('hidden');
  }

  function init() {
    dropEl = document.getElementById('redact-drop');
    editorEl = document.getElementById('redact-editor');
    canvasEl = document.getElementById('redact-canvas');
    overlayEl = document.getElementById('redact-overlay');
    pageWrapEl = document.getElementById('redact-page-wrap');
    pageInfoEl = document.getElementById('redact-pageinfo');
    countEl = document.getElementById('redact-count');
    deleteBtn = document.getElementById('redact-delete');
    ocrEl = document.getElementById('redact-ocr');
    ocrHintEl = document.getElementById('redact-ocr-hint');
    resultEl = document.getElementById('redact-result');

    setupDropzone(dropEl, document.getElementById('redact-input'), load, { multiple: false });
    setupDrawing();
    deleteBtn.addEventListener('click', deleteSelected);
    document.getElementById('redact-clear-page').addEventListener('click', clearPage);
    document.getElementById('redact-prev').addEventListener('click', () => nav(-1));
    document.getElementById('redact-next').addEventListener('click', () => nav(1));
    document.getElementById('redact-run').addEventListener('click', run);
    document.getElementById('redact-reset').addEventListener('click', reset);

    document.querySelectorAll('#redact-color button').forEach(b =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#redact-color button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        color = b.dataset.color;
        if (pdfjsDoc) renderOverlay();
      }));
    document.getElementById('redact-dpi').addEventListener('change', (e) => { dpi = +e.target.value; });

    // Tecla Supr / Retroceso borra el recuadro seleccionado (si la herramienta está visible).
    document.addEventListener('keydown', (e) => {
      if (!selected || editorEl.classList.contains('hidden')) return;
      if (document.getElementById('tool-redact').classList.contains('hidden')) return;
      if (/input|textarea|select/i.test(document.activeElement.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    });

    if (!OCR_AVAILABLE || typeof Tesseract === 'undefined') {
      ocrEl.checked = false;
      ocrEl.disabled = true;
      ocrHintEl.textContent = typeof Tesseract === 'undefined'
        ? 'OCR no disponible: falta la carpeta vendor/tesseract.'
        : 'OCR no disponible al abrir la app con doble clic en index.html. Ábrela con iniciar.bat para usarlo.';
    }
  }

  return { init };
})();
