/* Mirror-info: автоматический счётчик символов и страниц.
 * Подключать после translate-core.js и до calculator.js.
 */
(function () {
  'use strict';

  const CHARS_PER_PAGE = 1800;

  function $(id) {
    return document.getElementById(id);
  }

  function formatNumber(value, maximumFractionDigits = 0) {
    return Number(value).toLocaleString('ru-RU', {
      maximumFractionDigits
    });
  }

  function formatCategory(fileName, explicitFormat) {
    if (explicitFormat) return explicitFormat;

    const ext = String(fileName || '').split('.').pop().toLowerCase();
    if (['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff'].includes(ext)) {
      return 'scan';
    }
    if (['docx', 'epub', 'fb2'].includes(ext)) return 'document';
    return 'text';
  }

  function updateCalculator(characters, category) {
    const calcChars = $('calcChars');
    if (calcChars) {
      calcChars.value = String(characters);
      calcChars.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const calcFormat = $('calcFormat');
    if (calcFormat && category && [...calcFormat.options].some(option => option.value === category)) {
      calcFormat.value = category;
      calcFormat.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const sourceLanguage = $('srcLang');
    const calcLanguage = $('calcLang');
    const targetLanguage = $('tgtLang');
    if (calcLanguage && targetLanguage) {
      const target = targetLanguage.value;
      if ([...calcLanguage.options].some(option => option.value === target)) {
        calcLanguage.value = target;
        calcLanguage.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  function renderStats(text, details = {}) {
    const panel = $('documentStats');
    if (!panel) return;

    const value = String(text || '');
    const characters = value.length;

    if (!value.trim()) {
      panel.classList.add('hidden');
      const calcChars = $('calcChars');
      if (calcChars) {
        calcChars.value = '100';
        calcChars.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    const standardPages = characters / CHARS_PER_PAGE;
    const charsNode = $('docStatCharacters');
    const pagesNode = $('docStatStandardPages');
    const physicalNode = $('docStatPhysicalPages');
    const sourceNode = $('docStatSource');

    if (charsNode) charsNode.textContent = formatNumber(characters);
    if (pagesNode) pagesNode.textContent = formatNumber(standardPages, 3);

    if (physicalNode) {
      const count = Number(details.physicalPages);
      physicalNode.textContent = Number.isFinite(count) && count > 0
        ? formatNumber(count)
        : 'Не определяется для этого формата';
    }

    if (sourceNode) {
      sourceNode.textContent = details.fileName
        ? `Источник: ${details.fileName}`
        : 'Источник: введённый текст';
    }

    panel.classList.remove('hidden');
    updateCalculator(characters, formatCategory(details.fileName, details.format));
  }

  document.addEventListener('DOMContentLoaded', function () {
    const textInput = $('textInput');

    if (textInput) {
      textInput.addEventListener('input', function () {
        renderStats(textInput.value, {
          fileName: 'Введённый текст',
          physicalPages: null,
          format: 'text'
        });
      });

      if (textInput.value.trim()) {
        renderStats(textInput.value, {
          fileName: 'Введённый текст',
          physicalPages: null,
          format: 'text'
        });
      }
    }

    window.addEventListener('mirror-info:document-loaded', function (event) {
      const detail = event.detail || {};
      renderStats(detail.text || (textInput && textInput.value) || '', detail);
    });

    window.addEventListener('mirror-info:document-cleared', function () {
      renderStats('', {});
    });

    const clearButton = $('clearBtn');
    if (clearButton) {
      clearButton.addEventListener('click', function () {
        window.setTimeout(function () {
          renderStats(textInput ? textInput.value : '', {
            fileName: 'Введённый текст',
            physicalPages: null,
            format: 'text'
          });
        }, 0);
      });
    }

    const removeButton = $('fileRemove');
    if (removeButton) {
      removeButton.addEventListener('click', function () {
        window.setTimeout(function () {
          if (!textInput || !textInput.value.trim()) renderStats('', {});
        }, 0);
      });
    }
  });
})();
