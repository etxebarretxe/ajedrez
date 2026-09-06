/* app.js — Navegación entre herramientas, tema y arranque */
(function () {
  // Navegación de la barra lateral
  const navBtns = document.querySelectorAll('.nav-btn');
  const tools = document.querySelectorAll('.tool');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tool;
      tools.forEach(t => t.classList.toggle('hidden', t.id !== 'tool-' + target));
    });
  });

  // Tema claro/oscuro (recordado en localStorage)
  const themeBtn = document.getElementById('themeToggle');
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('pdftools-theme', t); } catch (e) {}
  }
  let saved = 'light';
  try { saved = localStorage.getItem('pdftools-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) {}
  applyTheme(saved);
  themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // Comprobación de librerías
  if (!window.PDFLib || !window.pdfjsLib) {
    toast('No se pudieron cargar las librerías locales (carpeta /vendor).', true);
    return;
  }

  // Inicializa cada herramienta
  Merge.init();
  Split.init();
  Organize.init();
  Compress.init();
  Edit.init();
})();
