/* merge.js — Unir varios PDF en uno */
const Merge = (() => {
  let files = []; // array de File
  let listEl, runBtn, clearBtn;

  function render() {
    listEl.innerHTML = '';
    files.forEach((file, idx) => {
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.idx = idx;
      li.innerHTML = `
        <span class="grip">⠿</span>
        <span class="fname">${escapeHtml(file.name)}</span>
        <span class="fsize">${formatBytes(file.size)}</span>
        <button class="remove" title="Quitar">✕</button>`;
      li.querySelector('.remove').addEventListener('click', () => {
        files.splice(idx, 1); render();
      });
      addDragHandlers(li);
      listEl.appendChild(li);
    });
    const has = files.length > 0;
    runBtn.disabled = files.length < 1;
    clearBtn.disabled = !has;
    runBtn.textContent = files.length >= 2 ? `Unir ${files.length} PDF y descargar` : 'Unir y descargar';
  }

  // Reordenación por arrastre
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

  async function run() {
    if (!files.length) return;
    showSpinner('Uniendo PDF…');
    try {
      const out = await PDFLib.PDFDocument.create();
      for (const file of files) {
        const bytes = await fileToArrayBuffer(file);
        const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(p => out.addPage(p));
      }
      const bytes = await out.save();
      downloadBytes(bytes, 'unido.pdf');
      toast('PDF unido y descargado.');
    } catch (err) {
      console.error(err);
      toast('No se pudo unir: ' + err.message, true);
    } finally {
      hideSpinner();
    }
  }

  function init() {
    listEl = document.getElementById('merge-list');
    runBtn = document.getElementById('merge-run');
    clearBtn = document.getElementById('merge-clear');
    setupDropzone(
      document.getElementById('merge-drop'),
      document.getElementById('merge-input'),
      (newFiles) => { files = files.concat(newFiles); render(); },
      { multiple: true }
    );
    runBtn.addEventListener('click', run);
    clearBtn.addEventListener('click', () => { files = []; render(); });
    render();
  }

  return { init };
})();

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
