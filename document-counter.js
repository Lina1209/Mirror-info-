/* Mirror-info: document statistics -> calculator bridge.
 * Add the matching stats panel markup to index.html and load this file
 * after translate-core.js but before calculator.js.
 */
(function () {
  'use strict';
  const CHARS_PER_PAGE = 1800;
  const WORDS_PER_PAGE = 250;
  const $ = id => document.getElementById(id);
  const fmt = n => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 });

  function render(text, details = {}) {
    const panel = $('documentStats');
    if (!panel) return;
    const value = String(text || '');
    const chars = value.length;
    const words = (value.trim().match(/\S+/g) || []).length;
    if (!value.trim()) {
      panel.classList.add('hidden');
      return;
    }
    const standardPages = chars / CHARS_PER_PAGE;
    const wordPages = words / WORDS_PER_PAGE;
    if ($('docStatCharacters')) $('docStatCharacters').textContent = fmt(chars);
    if ($('docStatWords')) $('docStatWords').textContent = fmt(words);
    if ($('docStatStandardPages')) $('docStatStandardPages').textContent = fmt(standardPages);
    if ($('docStatWordPages')) $('docStatWordPages').textContent = fmt(wordPages);
    if ($('docStatPhysicalPages')) $('docStatPhysicalPages').textContent =
      Number(details.physicalPages) > 0 ? fmt(details.physicalPages) : 'Не определяется для этого формата';
    if ($('docStatSource')) $('docStatSource').textContent =
      details.fileName ? 'Источник: ' + details.fileName : 'Источник: введённый текст';
    panel.classList.remove('hidden');

    const calcChars = $('calcChars');
    if (calcChars) {
      calcChars.value = String(chars);
      calcChars.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const calcFormat = $('calcFormat');
    const ext = String(details.fileName || '').split('.').pop().toLowerCase();
    const category = ['pdf','jpg','jpeg','png','webp','tif','tiff','bmp'].includes(ext)
      ? 'scan' : (['docx','epub','fb2','rtf'].includes(ext) ? 'document' : 'text');
    if (calcFormat && Array.from(calcFormat.options).some(o => o.value === category)) {
      calcFormat.value = category;
      calcFormat.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const input = $('textInput');
    if (input) {
      input.addEventListener('input', () => render(input.value, { fileName: 'Введённый текст' }));
      if (input.value.trim()) render(input.value, { fileName: 'Введённый текст' });
    }
    window.addEventListener('mirror-info:document-loaded', e => render(e.detail?.text || input?.value || '', e.detail || {}));
    window.addEventListener('mirror-info:document-cleared', () => render('', {}));
  });
})();
