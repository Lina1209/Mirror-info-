(function (window) {
  'use strict';

  const API_URL = '/api/translate';
  const MAX_CHUNK = 2400;

  async function translate(text, sourceLang = 'auto', targetLang = 'ru') {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ text, sourceLang, targetLang })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.translation !== 'string') {
      throw new Error(data.error || `Сервис перевода недоступен (${response.status}).`);
    }
    return data.translation;
  }

  async function getExchangeRates() {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/RUB');
      if (!response.ok) throw new Error('Rates unavailable');
      const data = await response.json();
      if (data?.result === 'success' && data.rates) {
        return { rates: data.rates, isLive: true, updatedAt: new Date().toLocaleDateString('ru-RU') };
      }
    } catch (_) { /* Use labelled fallback rates. */ }
    return { rates: { RUB: 1, KZT: 5.2, USD: 0.011, EUR: 0.010, BYN: 0.035, UAH: 0.45, GBP: 0.0085, CNY: 0.078, TRY: 0.37 }, isLive: false, updatedAt: 'базовый курс' };
  }

  async function submitOrder(orderData) {
    const response = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(orderData)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(result.error || 'Не удалось отправить заявку. Попробуйте позже.');
    return result;
  }

  window.AppAPI = { translate, getExchangeRates, submitOrder };

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('translateBtn');
    const fileInput = document.getElementById('fileInput');
    const textInput = document.getElementById('textInput');
    const dropZone = document.getElementById('dropZone');
    const resultText = document.getElementById('resultText');
    if (!button || !fileInput) return;

    let selectedFile = null;
    let downloadBlob = null;
    let downloadName = 'mirror-translation.txt';

    const byId = (id) => document.getElementById(id);
    function progress(value, label) {
      byId('progressWrap')?.classList.remove('hidden');
      if (byId('progressBar')) byId('progressBar').style.width = `${value}%`;
      if (byId('progressPercent')) byId('progressPercent').textContent = `${Math.round(value)}%`;
      if (byId('progressLabel')) byId('progressLabel').textContent = label;
    }
    function error(message) {
      if (byId('errorText')) byId('errorText').textContent = message;
      byId('errorWrap')?.classList.remove('hidden');
    }
    function clearError() { byId('errorWrap')?.classList.add('hidden'); }
    function setFile(file) {
      selectedFile = file;
      byId('fileChip')?.classList.remove('is-hidden');
      if (byId('fileChipName')) byId('fileChipName').textContent = file.name;
      if (byId('fileChipMeta')) byId('fileChipMeta').textContent = `${(file.size / 1024).toFixed(1)} KB`;
      clearError();
    }
    function readText(file) { return file.text(); }

    async function translateString(value, onProgress) {
      const sourceLang = byId('srcLang')?.value || 'auto';
      const targetLang = byId('tgtLang')?.value || 'ru';
      const chunks = [];
      let rest = value;
      while (rest.length) {
        let end = Math.min(MAX_CHUNK, rest.length);
        if (end < rest.length) {
          const boundary = Math.max(rest.lastIndexOf('\n', end), rest.lastIndexOf(' ', end), rest.lastIndexOf('. ', end));
          if (boundary > end * 0.55) end = boundary + 1;
        }
        chunks.push(rest.slice(0, end));
        rest = rest.slice(end);
      }
      if (!chunks.length) return '';
      let output = '';
      for (let i = 0; i < chunks.length; i++) {
        output += await translate(chunks[i], sourceLang, targetLang);
        onProgress?.((i + 1) / chunks.length);
      }
      return output;
    }

    function setTextNodes(paragraph, translated) {
      const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      if (!nodes.length) return;
      nodes[0].nodeValue = translated;
      for (let i = 1; i < nodes.length; i++) nodes[i].nodeValue = '';
    }

    async function translateXmlFile(zip, path, progressCallback) {
      const file = zip.file(path);
      if (!file) return '';
      const xml = await file.async('string');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error(`Не удалось разобрать структуру файла ${path}.`);
      const isDocx = path.startsWith('word/');
      const paragraphs = [...doc.getElementsByTagName(isDocx ? 'w:p' : 'p')];
      const candidates = paragraphs.filter((p) => p.textContent.trim());
      let all = '';
      for (let i = 0; i < candidates.length; i++) {
        const source = candidates[i].textContent;
        const result = await translateString(source, (fraction) => progressCallback((i + fraction) / Math.max(1, candidates.length)));
        setTextNodes(candidates[i], result);
        all += `${result}\n\n`;
      }
      zip.file(path, new XMLSerializer().serializeToString(doc));
      return all;
    }

    async function translateArchive(file, extension, onProgress) {
      if (!window.JSZip) throw new Error('Не удалось загрузить обработчик архивов. Обновите страницу и попробуйте ещё раз.');
      const zip = await JSZip.loadAsync(file);
      let paths;
      if (extension === 'docx') {
        paths = Object.keys(zip.files).filter((path) => /^word\/(document|header\d*|footer\d*)\.xml$/i.test(path));
      } else if (extension === 'epub') {
        paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir && /\.(xhtml|html|htm)$/i.test(path));
      } else {
        paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir && /\.xml$/i.test(path));
      }
      if (!paths.length) throw new Error('В файле не найдены страницы с текстом для перевода.');
      let output = '';
      for (let i = 0; i < paths.length; i++) {
        output += await translateXmlFile(zip, paths[i], (fraction) => onProgress((i + fraction) / paths.length));
      }
      return { blob: await zip.generateAsync({ type: 'blob' }), text: output, extension };
    }

    async function translatePdf(file, onProgress) {
      if (!window.pdfjsLib) throw new Error('Не загрузился PDF.js. Обновите страницу и попробуйте снова.');
      const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(' '));
        onProgress(i / pdf.numPages * 0.25);
      }
      const source = pages.join('\n\n');
      const translated = await translateString(source, (fraction) => onProgress(0.25 + fraction * 0.75));
      return { blob: new Blob([translated], { type: 'text/plain;charset=utf-8' }), text: translated, extension: 'txt', pdfTextOnly: true };
    }

    async function translateDocument(file, onProgress) {
      const extension = file.name.split('.').pop().toLowerCase();
      if (['docx', 'epub', 'fb2'].includes(extension)) return translateArchive(file, extension, onProgress);
      if (extension === 'pdf') return translatePdf(file, onProgress);
      if (!/^(txt|md|markdown|csv|tsv|json|xml|html|htm|srt|vtt|log|ini|yml|yaml|rtf)$/.test(extension)) {
        throw new Error('Формат не поддержан. Доступны TXT, MD, CSV, XML, HTML, DOCX, EPUB, FB2 и текстовые PDF.');
      }
      const source = await readText(file);
      const translated = await translateString(source, onProgress);
      const mime = extension === 'html' || extension === 'htm' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8';
      return { blob: new Blob([translated], { type: mime }), text: translated, extension };
    }

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) setFile(file);
    });
    dropZone?.addEventListener('click', () => fileInput.click());
    dropZone?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
    });
    dropZone?.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
    dropZone?.addEventListener('drop', (event) => {
      event.preventDefault(); dropZone.classList.remove('is-dragging');
      const file = event.dataTransfer?.files?.[0];
      if (file) { setFile(file); try { const transfer = new DataTransfer(); transfer.items.add(file); fileInput.files = transfer.files; } catch (_) {} }
    });
    byId('fileRemove')?.addEventListener('click', () => {
      selectedFile = null; fileInput.value = ''; byId('fileChip')?.classList.add('is-hidden');
    });
    byId('pickGalleryBtn')?.addEventListener('click', () => byId('galleryInput')?.click());
    byId('galleryInput')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setFile(file);
      if (byId('photoPreview')) {
        const img = document.createElement('img'); img.alt = 'Предпросмотр изображения'; img.style.maxHeight = '260px'; img.src = URL.createObjectURL(file);
        byId('photoPreview').replaceChildren(img);
      }
      error('Для фото и сканов требуется распознавание OCR; загрузка изображения сама по себе не извлекает текст. Введите распознанный текст вручную или используйте PDF с текстовым слоем.');
    });
    byId('swapLangs')?.addEventListener('click', () => {
      const source = byId('srcLang'); const target = byId('tgtLang');
      if (source && target && source.value !== 'auto') [source.value, target.value] = [target.value, source.value];
    });

    button.addEventListener('click', async () => {
      clearError();
      byId('resultWrap')?.classList.add('hidden');
      const source = textInput?.value.trim() || '';
      if (!selectedFile && !source) { error('Выберите файл или введите текст для перевода.'); return; }
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        progress(2, 'Читаем файл…');
        let result;
        if (selectedFile) {
          result = await translateDocument(selectedFile, (fraction) => progress(10 + Math.min(85, fraction * 85), 'Переводим документ…'));
        } else {
          const translated = await translateString(source, (fraction) => progress(10 + fraction * 85, 'Переводим текст…'));
          result = { blob: new Blob([translated], { type: 'text/plain;charset=utf-8' }), text: translated, extension: 'txt' };
        }
        downloadBlob = result.blob;
        const stem = (selectedFile?.name || 'mirror-translation').replace(/\.[^.]+$/, '');
        downloadName = `${stem}-translated.${result.extension}`;
        if (resultText) resultText.textContent = result.text || 'Перевод готов. Скачайте файл для просмотра.';
        if (byId('resultMeta')) byId('resultMeta').textContent = `${byId('srcLang')?.value || 'auto'} → ${byId('tgtLang')?.value || 'ru'} · ${result.text.length.toLocaleString('ru-RU')} символов`;
        if (byId('resultNote')) byId('resultNote').textContent = result.pdfTextOnly
          ? 'PDF распознан как текстовый слой. Сейчас результат скачивается как TXT; исходная вёрстка PDF и OCR сканов не поддерживаются.'
          : 'Структура DOCX/EPUB/FB2 и исходные ресурсы архива сохранены по возможности; проверьте результат перед использованием.';
        byId('resultWrap')?.classList.remove('hidden');
        progress(100, 'Перевод завершён');
        setTimeout(() => byId('progressWrap')?.classList.add('hidden'), 900);
      } catch (err) {
        byId('progressWrap')?.classList.add('hidden');
        error(err.message || 'Не удалось завершить перевод. Проверьте подключение и повторите попытку.');
      } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    });

    byId('downloadBtn')?.addEventListener('click', () => {
      if (!downloadBlob) return;
      const url = URL.createObjectURL(downloadBlob);
      const link = document.createElement('a'); link.href = url; link.download = downloadName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    byId('copyBtn')?.addEventListener('click', async () => {
      const text = resultText?.textContent || '';
      try { await navigator.clipboard.writeText(text); }
      catch (_) { error('Буфер обмена недоступен. Выделите текст предпросмотра и скопируйте вручную.'); }
    });
    byId('viewBtn')?.addEventListener('click', () => resultText?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    byId('clearBtn')?.addEventListener('click', () => {
      textInput && (textInput.value = ''); selectedFile = null; downloadBlob = null; fileInput.value = '';
      byId('fileChip')?.classList.add('is-hidden'); byId('resultWrap')?.classList.add('hidden');
      byId('progressWrap')?.classList.add('hidden'); clearError();
    });
  });
})(window);
