/* compress.js — Reducir el tamaño del PDF */
const Compress = (() => {
  let file = null, bytes = null;
  let dropEl, configEl, metaEl, levelEl, losslessEl, hintEl, resultEl;
  let level = 'low';

  // Parámetros por nivel: escala de render (relativa a 72 dpi) y calidad JPEG.
  const PRESETS = {
    low:    { scale: 2.0, quality: 0.72 },
    medium: { scale: 1.5, quality: 0.60 },
    high:   { scale: 1.0, quality: 0.50 },
  };

  async function load(files) {
    file = files[0];
    bytes = await fileToArrayBuffer(file);
    metaEl.textContent = `${file.name} · ${formatBytes(file.size)}`;
    dropEl.classList.add('hidden');
    configEl.classList.remove('hidden');
    resultEl.classList.add('hidden');
  }

  function dataURLToBytes(dataURL) {
    const b64 = dataURL.split(',')[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function losslessOptimize() {
    const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    return await doc.save({ useObjectStreams: true });
  }

  async function rasterize() {
    const { scale, quality } = PRESETS[level];
    const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const out = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= pdfjsDoc.numPages; i++) {
      showSpinner(`Comprimiendo página ${i}/${pdfjsDoc.numPages}…`);
      const page = await pdfjsDoc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const jpg = await out.embedJpg(dataURLToBytes(canvas.toDataURL('image/jpeg', quality)));
      // Tamaño de página en puntos (el viewport ya incluye la rotación).
      const wPt = viewport.width / scale;
      const hPt = viewport.height / scale;
      const p = out.addPage([wPt, hPt]);
      p.drawImage(jpg, { x: 0, y: 0, width: wPt, height: hPt });
    }
    return await out.save();
  }

  async function run() {
    if (!bytes) return;
    const lossless = losslessEl.checked;
    showSpinner('Comprimiendo…');
    try {
      const outBytes = lossless ? await losslessOptimize() : await rasterize();
      const before = file.size, after = outBytes.byteLength;
      const pct = Math.round((1 - after / before) * 100);
      const blob = new Blob([outBytes], { type: 'application/pdf' });

      resultEl.className = 'result ok';
      resultEl.innerHTML = '';
      const info = document.createElement('p');
      if (after >= before) {
        info.innerHTML = `Antes: <b>${formatBytes(before)}</b> → Después: <b>${formatBytes(after)}</b>. ` +
          `Este PDF ya estaba optimizado; no se ha reducido${lossless ? '' : ' (prueba un nivel más fuerte)'}. Puedes descargarlo igualmente.`;
      } else {
        info.innerHTML = `Antes: <b>${formatBytes(before)}</b> → Después: <b>${formatBytes(after)}</b> ` +
          `(<b>−${pct}%</b>).`;
      }
      const dl = document.createElement('button');
      dl.className = 'btn primary';
      dl.textContent = 'Descargar PDF comprimido';
      dl.style.marginTop = '10px';
      dl.addEventListener('click', () => downloadBlob(blob, `${baseName(file.name)}_comprimido.pdf`));
      resultEl.appendChild(info);
      resultEl.appendChild(dl);
      resultEl.classList.remove('hidden');
      toast('Compresión terminada.');
    } catch (err) {
      console.error(err);
      toast('No se pudo comprimir: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  function reset() {
    file = bytes = null;
    configEl.classList.add('hidden');
    dropEl.classList.remove('hidden');
    resultEl.classList.add('hidden');
  }

  function init() {
    dropEl = document.getElementById('compress-drop');
    configEl = document.getElementById('compress-config');
    metaEl = document.getElementById('compress-meta');
    levelEl = document.getElementById('compress-level');
    losslessEl = document.getElementById('compress-lossless');
    hintEl = document.getElementById('compress-hint');
    resultEl = document.getElementById('compress-result');

    setupDropzone(dropEl, document.getElementById('compress-input'), load, { multiple: false });
    levelEl.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => {
        levelEl.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        level = b.dataset.level;
      }));
    losslessEl.addEventListener('change', () => {
      levelEl.style.opacity = losslessEl.checked ? '.4' : '1';
      levelEl.style.pointerEvents = losslessEl.checked ? 'none' : 'auto';
    });
    document.getElementById('compress-run').addEventListener('click', run);
    document.getElementById('compress-clear').addEventListener('click', reset);
  }

  return { init };
})();
