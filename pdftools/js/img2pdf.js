/* img2pdf.js — Convierte una o varias imágenes (JPG, PNG, WEBP...) en un PDF.

   Cada imagen pasa por un <canvas> antes de insertarse: así se respeta la
   rotación EXIF de las fotos de móvil. Si no se hiciera esto, una foto hecha
   en vertical con el teléfono podría insertarse "tumbada" en el PDF aunque
   se vea perfectamente recta en la galería del móvil (pdf-lib, al insertar
   el JPEG original, no aplica esa rotación por sí sola; el navegador sí lo
   hace al decodificar la imagen en un canvas). De paso, convertir siempre a
   PNG antes de insertar da una única ruta de código para cualquier formato
   que el navegador sepa abrir, sin depender de si pdf-lib lo soporta. */
const Img2Pdf = (() => {
  let files = [];                 // array de File
  let objectUrls = new Map();     // File -> URL de objeto (para la miniatura)
  let sizeMode = 'fit';           // 'fit' (tamaño de cada imagen) | 'a4'
  let listEl, optionsEl, runBtn, clearBtn, sizeButtons;

  function thumbUrlFor(file) {
    if (!objectUrls.has(file)) objectUrls.set(file, URL.createObjectURL(file));
    return objectUrls.get(file);
  }

  function render() {
    listEl.innerHTML = '';
    files.forEach((file, idx) => {
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.idx = idx;
      li.innerHTML = `
        <span class="grip">⠿</span>
        <img class="thumb-img" src="${thumbUrlFor(file)}" alt="">
        <span class="fname">${escapeHtml(file.name)}</span>
        <span class="fsize">${formatBytes(file.size)}</span>
        <button class="remove" title="Quitar">✕</button>`;
      li.querySelector('.remove').addEventListener('click', () => {
        const [removed] = files.splice(idx, 1);
        const url = objectUrls.get(removed);
        if (url) { URL.revokeObjectURL(url); objectUrls.delete(removed); }
        render();
      });
      addDragHandlers(li);
      listEl.appendChild(li);
    });
    const has = files.length > 0;
    optionsEl.hidden = !has;
    runBtn.disabled = !has;
    clearBtn.disabled = !has;
    runBtn.textContent = files.length >= 2 ? `Crear PDF con ${files.length} imágenes` : 'Crear PDF';
  }

  // Reordenación por arrastre (mismo patrón que "Unir")
  let dragIdx = null;
  function addDragHandlers(li) {
    li.addEventListener('dragstart', () => { dragIdx = +li.dataset.idx; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIdx = +li.dataset.idx;
      if (dragIdx === null || dragIdx === targetIdx) return;
      const [moved] = files.splice(dragIdx, 1);
      files.splice(targetIdx, 0, moved);
      dragIdx = null;
      render();
    });
  }

  async function embedImage(doc, file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const image = await doc.embedPng(dataURLToBytes(canvas.toDataURL('image/png')));
    return { image, w: image.width, h: image.height };
  }

  async function run() {
    if (!files.length) return;
    showSpinner('Creando PDF…');
    try {
      const doc = await PDFLib.PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        showSpinner(`Procesando imagen ${i + 1}/${files.length}…`);
        const { image, w, h } = await embedImage(doc, files[i]);
        if (sizeMode === 'a4') {
          const PAGE_W = 595, PAGE_H = 842, MARGIN = 24;
          const maxW = PAGE_W - MARGIN * 2, maxH = PAGE_H - MARGIN * 2;
          const scale = Math.min(maxW / w, maxH / h);
          const dw = w * scale, dh = h * scale;
          const page = doc.addPage([PAGE_W, PAGE_H]);
          page.drawImage(image, { x: (PAGE_W - dw) / 2, y: (PAGE_H - dh) / 2, width: dw, height: dh });
        } else {
          const page = doc.addPage([w, h]);
          page.drawImage(image, { x: 0, y: 0, width: w, height: h });
        }
      }
      const outBytes = await doc.save();
      downloadBytes(outBytes, 'imagenes.pdf');
      toast(`PDF creado con ${files.length} imagen(es).`);
    } catch (err) {
      console.error(err);
      toast('No se pudo crear el PDF: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  function clearAll() {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls = new Map();
    files = [];
    render();
  }

  function init() {
    listEl = document.getElementById('img2pdf-list');
    optionsEl = document.getElementById('img2pdf-options');
    runBtn = document.getElementById('img2pdf-run');
    clearBtn = document.getElementById('img2pdf-clear');
    sizeButtons = document.getElementById('img2pdf-size');

    setupDropzone(
      document.getElementById('img2pdf-drop'),
      document.getElementById('img2pdf-input'),
      (newFiles) => { files = files.concat(newFiles); render(); },
      {
        multiple: true,
        filter: f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name),
        invalidMessage: 'Selecciona archivos de imagen válidos (JPG, PNG, WEBP...).',
      }
    );
    sizeButtons.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => {
        sizeButtons.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        sizeMode = b.dataset.size;
      }));
    runBtn.addEventListener('click', run);
    clearBtn.addEventListener('click', clearAll);
    render();
  }

  return { init };
})();
