/* watermark.js — Marca de agua diagonal repetida + aplanado.

   Equivalente web del script marca_agua.py: cada página (de PDF o imagen) se
   dibuja en un canvas, se le superpone el texto en diagonal y en mosaico, y el
   resultado se guarda como imagen JPEG dentro de un PDF nuevo. Al aplanar, la
   marca queda "quemada" en los píxeles y no se puede quitar con un editor de
   PDF (tampoco queda texto seleccionable del original).

   Todo ocurre en el navegador; no se sube nada a internet. */
const Watermark = (() => {
  let files = [];
  let baseCanvas = null;       // primera página renderizada (para la vista previa)
  let baseToken = 0;
  let el = {};

  const QUALITY = {
    ligera: { dpi: 150, q: 0.75 },
    normal: { dpi: 200, q: 0.85 },
    alta:   { dpi: 300, q: 0.90 },
  };

  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const isImage = (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name);

  function todayISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function formatDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // Texto final: "<texto> <destinatario> - <motivo> - <fecha>" (omite lo vacío)
  function composeText() {
    const parts = [];
    const first = [el.texto.value.trim(), el.dest.value.trim()].filter(Boolean).join(' ');
    if (first) parts.push(first);
    if (el.motivo.value.trim()) parts.push(el.motivo.value.trim());
    if (el.useDate.checked && el.date.value) parts.push(formatDate(el.date.value));
    return parts.join(' - ');
  }

  function options() {
    return {
      text: composeText(),
      color: el.color.value,
      opacity: parseFloat(el.opacity.value) / 100,
      angle: parseFloat(el.angle.value) || 0,
      escala: parseFloat(el.size.value) / 100,
    };
  }

  // Dibuja el texto en diagonal, repetido en mosaico (filas al tresbolillo),
  // cubriendo toda la página. El tamaño de letra es relativo al lado menor,
  // así la marca se ve igual en la vista previa y en el resultado final.
  function drawWatermark(ctx, w, h, { text, color, opacity, angle, escala }) {
    if (!text) return;
    const size = Math.max(12, Math.round(Math.min(w, h) * escala));
    ctx.save();
    ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    const stepX = ctx.measureText(text).width + size * 2;
    const stepY = size * 2.8;
    const diag = Math.hypot(w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-angle * Math.PI / 180);
    let row = 0;
    for (let y = -diag / 2; y < diag / 2; y += stepY, row++) {
      const offset = row % 2 ? stepX / 2 : 0;
      for (let x = -diag / 2 - stepX + offset; x < diag / 2; x += stepX) {
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();
  }

  /* ---------- Lectura de páginas ---------- */

  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }

  async function openPdf(file) {
    try {
      return await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    } catch (err) {
      if (err && err.name === 'PasswordException') {
        throw new Error(`${file.name} está protegido con contraseña; desbloquéalo antes.`);
      }
      throw err;
    }
  }

  // Llama a cb(canvas) por cada página de cada archivo, a la resolución dada.
  // Un único canvas vivo a la vez: así no se acumula memoria en documentos largos.
  async function forEachPage(list, dpi, cb) {
    const scale = dpi / 72;
    for (const file of list) {
      if (isPdf(file)) {
        const doc = await openPdf(file);
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale });
          const canvas = newCanvas(vp.width, vp.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          await cb(canvas);
        }
        doc.destroy();
      } else {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const canvas = newCanvas(bmp.width, bmp.height);
        canvas.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        await cb(canvas);
      }
    }
  }

  const toJpeg = (canvas, q) => new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo codificar la página.')), 'image/jpeg', q));

  /* ---------- Vista previa ---------- */

  async function loadBase() {
    const token = ++baseToken;
    baseCanvas = null;
    if (!files.length) { drawPreview(); return; }
    try {
      const first = files[0];
      let canvas;
      if (isPdf(first)) {
        const doc = await openPdf(first);
        const page = await doc.getPage(1);
        const unscaled = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 700 / unscaled.width });
        canvas = newCanvas(vp.width, vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        doc.destroy();
      } else {
        const bmp = await createImageBitmap(first, { imageOrientation: 'from-image' });
        const k = 700 / bmp.width;
        canvas = newCanvas(bmp.width * k, bmp.height * k);
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        bmp.close();
      }
      if (token !== baseToken) return;
      baseCanvas = canvas;
    } catch (err) {
      console.error(err);
      toast('No se pudo generar la vista previa: ' + err.message, true);
    }
    drawPreview();
  }

  function drawPreview() {
    const c = el.preview;
    el.finalText.textContent = composeText() || '(escribe el texto de la marca)';
    if (!baseCanvas) {
      c.hidden = true; el.previewEmpty.hidden = false;
      return;
    }
    c.hidden = false; el.previewEmpty.hidden = true;
    c.width = baseCanvas.width; c.height = baseCanvas.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(baseCanvas, 0, 0);
    drawWatermark(ctx, c.width, c.height, options());
  }

  let raf = 0;
  function schedulePreview() {
    el.sizeVal.textContent = el.size.value;
    el.opacityVal.textContent = el.opacity.value + '%';
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawPreview);
  }

  /* ---------- Lista de archivos ---------- */

  function renderList() {
    el.list.innerHTML = '';
    files.forEach((file, idx) => {
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.idx = idx;
      li.innerHTML = `
        <span class="grip">⠿</span>
        <span>${isPdf(file) ? '📄' : '🖼️'}</span>
        <span class="fname">${escapeHtml(file.name)}</span>
        <span class="fsize">${formatBytes(file.size)}</span>
        <button class="remove" title="Quitar">✕</button>`;
      li.querySelector('.remove').addEventListener('click', () => {
        files.splice(idx, 1); renderList(); loadBase();
      });
      addDragHandlers(li);
      el.list.appendChild(li);
    });
    el.run.disabled = !files.length;
    el.clear.disabled = !files.length;
  }

  let dragIdx = null;
  function addDragHandlers(li) {
    li.addEventListener('dragstart', () => { dragIdx = +li.dataset.idx; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = +li.dataset.idx;
      if (dragIdx === null || dragIdx === target) return;
      const [moved] = files.splice(dragIdx, 1);
      files.splice(target, 0, moved);
      dragIdx = null;
      renderList(); loadBase();
    });
  }

  /* ---------- Generar ---------- */

  async function run() {
    const opts = options();
    if (!files.length) return;
    if (!opts.text) { toast('Escribe el texto de la marca de agua.', true); return; }
    const { dpi, q } = QUALITY[el.quality.value];
    showSpinner('Aplicando marca de agua…');
    try {
      // updateMetadata:false -> sin autor, programa ni fechas en los metadatos
      const doc = await PDFLib.PDFDocument.create({ updateMetadata: false });
      let count = 0;
      await forEachPage(files, dpi, async (canvas) => {
        count++;
        showSpinner(`Procesando página ${count}…`);
        drawWatermark(canvas.getContext('2d'), canvas.width, canvas.height, opts);
        const jpg = await doc.embedJpg(new Uint8Array(await (await toJpeg(canvas, q)).arrayBuffer()));
        const page = doc.addPage([canvas.width * 72 / dpi, canvas.height * 72 / dpi]);
        page.drawImage(jpg, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      });
      const bytes = await doc.save();
      const name = files.length === 1 ? `${baseName(files[0].name)}_marca_agua.pdf` : 'documentos_marca_agua.pdf';
      downloadBytes(bytes, name);
      toast(`Listo: ${count} página(s) con marca de agua.`);
    } catch (err) {
      console.error(err);
      toast('No se pudo aplicar la marca: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  function init() {
    const $ = (id) => document.getElementById(id);
    el = {
      list: $('wm-list'), run: $('wm-run'), clear: $('wm-clear'),
      texto: $('wm-texto'), dest: $('wm-dest'), motivo: $('wm-motivo'),
      useDate: $('wm-usedate'), date: $('wm-date'), finalText: $('wm-final'),
      color: $('wm-color'), size: $('wm-size'), sizeVal: $('wm-size-val'),
      opacity: $('wm-opacity'), opacityVal: $('wm-opacity-val'),
      angle: $('wm-angle'), quality: $('wm-quality'),
      preview: $('wm-preview'), previewEmpty: $('wm-preview-empty'),
    };
    el.date.value = todayISO();

    setupDropzone($('wm-drop'), $('wm-input'),
      (newFiles) => { files = files.concat(newFiles); renderList(); loadBase(); },
      {
        multiple: true,
        filter: (f) => isPdf(f) || isImage(f),
        invalidMessage: 'Selecciona archivos PDF o imágenes (JPG, PNG, WEBP...).',
      });

    [el.texto, el.dest, el.motivo, el.date, el.color, el.size, el.opacity, el.angle]
      .forEach(i => i.addEventListener('input', schedulePreview));
    el.useDate.addEventListener('change', () => { el.date.disabled = !el.useDate.checked; schedulePreview(); });
    el.run.addEventListener('click', run);
    el.clear.addEventListener('click', () => { files = []; renderList(); loadBase(); });
    renderList();
    schedulePreview();
  }

  return { init };
})();
