/* Mirror-info: надёжная загрузка и чтение документов.
 * Поддержка: TXT/MD/CSV/JSON/XML/HTML/RTF, DOCX, EPUB, FB2, PDF и изображения.
 * PDF со сканами и изображения распознаются через Tesseract.js (OCR).
 * Не показываем посетителям технические параметры инфраструктуры.
 * Обработка зависит от памяти устройства, браузера и доступности сервисов.
 */
(function () {
  'use strict';

  const OCR_LANG = 'rus+eng';
  let selectedFileText = '';
  let selectedFile = null;
  let ocrWorkerPromise = null;

  const $ = (id) => document.getElementById(id);

  function showError(message) {
    const wrap = $('errorWrap');
    const text = $('errorText');
    if (wrap && text) {
      text.textContent = message || 'Не удалось обработать файл.';
      wrap.classList.remove('hidden');
    }
  }
  function clearError() {
    $('errorWrap')?.classList.add('hidden');
  }
  function progress(percent, label) {
    $('progressWrap')?.classList.remove('hidden');
    if ($('progressBar')) $('progressBar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if ($('progressPercent')) $('progressPercent').textContent = `${Math.round(percent)}%`;
    if ($('progressLabel')) $('progressLabel').textContent = label;
  }
  function hideProgress() { $('progressWrap')?.classList.add('hidden'); }

  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((s) => s.src === src);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('Не загрузилась библиотека обработки файла.')), { once: true });
        if (test()) resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Не удалось загрузить компонент обработки документа. Проверьте интернет-соединение и попробуйте ещё раз.'));
      document.head.appendChild(script);
    });
  }

  async function ensurePdfJs() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', () => !!window.pdfjsLib);
    if (!window.pdfjsLib) throw new Error('Компонент чтения PDF не загрузился.');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return window.pdfjsLib;
  }
  async function ensureMammoth() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js', () => !!window.mammoth);
    if (!window.mammoth) throw new Error('Компонент чтения DOCX не загрузился.');
    return window.mammoth;
  }
  async function ensureJSZip() {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', () => !!window.JSZip);
    if (!window.JSZip) throw new Error('Компонент чтения EPUB не загрузился.');
    return window.JSZip;
  }
  async function ensureTesseract() {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js', () => !!window.Tesseract);
    if (!window.Tesseract) throw new Error('Компонент распознавания сканов не загрузился.');
    if (!ocrWorkerPromise) {
      ocrWorkerPromise = window.Tesseract.createWorker(OCR_LANG, 1, {
        logger: (event) => {
          if (event.status === 'recognizing text' && event.progress) {
            progress(35 + event.progress * 35, 'Распознаём текст на скане…');
          }
        }
      });
    }
    return ocrWorkerPromise;
  }

  function extension(file) {
    return (file.name.split('.').pop() || '').toLowerCase();
  }
  function updateFileChip(file) {
    if ($('fileChip')) $('fileChip').classList.remove('is-hidden');
    if ($('fileChipName')) $('fileChipName').textContent = file.name;
    if ($('fileChipMeta')) $('fileChipMeta').textContent =
      `${(file.size / 1024 / 1024).toFixed(2)} МБ · ${file.type || 'тип файла определён по расширению'}`;
  }
  function previewImage(file) {
    const target = $('photoPreview');
    if (!target) return;
    const url = URL.createObjectURL(file);
    target.replaceChildren();
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Предпросмотр загруженного изображения';
    img.style.cssText = 'max-width:100%;max-height:280px;object-fit:contain;border-radius:14px;';
    img.onload = () => URL.revokeObjectURL(url);
    target.appendChild(img);
  }

  async function readText(file) {
    const buffer = await file.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (_) {
      try { return new TextDecoder('windows-1251').decode(buffer); }
      catch (_) { throw new Error('Не удалось определить кодировку. Сохраните документ в UTF-8 и загрузите снова.'); }
    }
  }

  async function readDocx(file) {
    const mammoth = await ensureMammoth();
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value || '';
  }

  async function readFb2(file) {
    const xml = await readText(file);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Файл FB2 повреждён или содержит некорректный XML.');
    return [...doc.querySelectorAll('body, title, annotation, epigraph, section')].map((n) => n.textContent.trim()).filter(Boolean).join('\n\n');
  }

  async function readEpub(file) {
    const JSZip = await ensureJSZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('В EPUB отсутствует файл META-INF/container.xml.');
    const container = new DOMParser().parseFromString(await containerFile.async('text'), 'application/xml');
    const rootfile = container.querySelector('rootfile')?.getAttribute('full-path');
    if (!rootfile) throw new Error('Не удалось найти структуру книги EPUB.');
    const opfFile = zip.file(rootfile);
    if (!opfFile) throw new Error('В EPUB отсутствует файл описания книги.');
    const opf = new DOMParser().parseFromString(await opfFile.async('text'), 'application/xml');
    const manifest = new Map();
    opf.querySelectorAll('manifest item').forEach((item) => {
      manifest.set(item.getAttribute('id'), item.getAttribute('href'));
    });
    const base = rootfile.includes('/') ? rootfile.slice(0, rootfile.lastIndexOf('/') + 1) : '';
    const sections = [];
    for (const item of opf.querySelectorAll('spine itemref')) {
      const href = manifest.get(item.getAttribute('idref'));
      if (!href) continue;
      const path = (base + decodeURIComponent(href)).replace(/\\/g, '/');
      const entry = zip.file(path) || zip.file(base + href);
      if (!entry) continue;
      const html = new DOMParser().parseFromString(await entry.async('text'), 'text/html');
      html.querySelectorAll('script,style,nav').forEach((n) => n.remove());
      const text = (html.body?.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) sections.push(text);
    }
    return sections.join('\n\n');
  }

  async function ocrImage(source) {
    const worker = await ensureTesseract();
    const result = await worker.recognize(source);
    return result.data?.text || '';
  }

  async function readPdf(file) {
    const pdfjs = await ensurePdfJs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      progress(5 + pageNo / pdf.numPages * 65, `Читаем PDF: страница ${pageNo} из ${pdf.numPages}…`);
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      let text = content.items.map((item) => item.str || '').join(' ').replace(/[ \t]+/g, ' ').trim();
      if (text.length < 25) {
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: context, viewport }).promise;
        try {
          text = await ocrImage(canvas);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      if (text) pages.push(text);
    }
    return pages.join('\n\n');
  }

  async function extractFile(file) {
    if (!file) throw new Error('Сначала выберите файл.');
    if (file.size === 0) throw new Error('Выбран пустой файл.');
    const ext = extension(file);
    if (file.type.startsWith('image/') || ['jpg','jpeg','png','webp','bmp','tif','tiff'].includes(ext)) {
      return await ocrImage(file);
    }
    if (ext === 'pdf') return await readPdf(file);
    if (ext === 'docx') return await readDocx(file);
    if (ext === 'epub') return await readEpub(file);
    if (ext === 'fb2') return await readFb2(file);
    if (['txt','md','markdown','csv','tsv','json','xml','html','htm','srt','vtt','log','ini','yml','yaml','rtf'].includes(ext)) {
      let text = await readText(file);
      if (ext === 'rtf') text = text.replace(/\\'[0-9a-f]{2}/gi, ' ').replace(/\\[a-z]+-?\d* ?/gi, ' ').replace(/[{}]/g, ' ').replace(/\s+/g, ' ');
      return text;
    }
    throw new Error(`Формат .${ext || 'неизвестен'} пока не поддерживается. Поддерживаются PDF, DOCX, EPUB, FB2, TXT, RTF, MD, CSV, HTML, JSON и изображения JPG/PNG/WEBP/TIFF.`);
  }

  function splitText(text, maxLength = 3200) {
    const paragraphs = text.split(/\n{2,}/);
    const chunks = [];
    let current = '';
    for (const paragraph of paragraphs) {
      let part = paragraph;
      while (part.length > maxLength) {
        if (current) { chunks.push(current); current = ''; }
        let cut = part.lastIndexOf(' ', maxLength);
        if (cut < maxLength * 0.55) cut = maxLength;
        chunks.push(part.slice(0, cut));
        part = part.slice(cut).trim();
      }
      if ((current + '\n\n' + part).trim().length > maxLength && current) {
        chunks.push(current);
        current = part;
      } else {
        current = (current ? current + '\n\n' : '') + part;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  async function translateInParts(text) {
    if (!window.AppAPI?.translate) throw new Error('Сервис перевода пока не подключён.');
    const source = $('srcLang')?.value || 'auto';
    const target = $('tgtLang')?.value || 'ru';
    const chunks = splitText(text);
    const translated = [];
    for (let i = 0; i < chunks.length; i++) {
      progress(72 + (i / chunks.length) * 25, `Переводим фрагмент ${i + 1} из ${chunks.length}…`);
      translated.push(await window.AppAPI.translate(chunks[i], source, target));
    }
    return translated.join('\n\n');
  }

  function showResult(file, text) {
    if ($('resultMeta')) $('resultMeta').textContent = `${file?.name || 'Текст'} · ${text.length.toLocaleString('ru-RU')} символов`;
    if ($('resultText')) $('resultText').textContent = text;
    if ($('resultNote')) $('resultNote').textContent = 'Результат можно скопировать или скачать как TXT. Для сложной вёрстки оригинала форматирование пока не сохраняется.';
    $('resultWrap')?.classList.remove('hidden');
  }

  function clearSelection() {
    selectedFile = null;
    selectedFileText = '';
    if ($('fileInput')) $('fileInput').value = '';
    if ($('galleryInput')) $('galleryInput').value = '';
    $('fileChip')?.classList.add('is-hidden');
    if ($('fileChipName')) $('fileChipName').textContent = '';
    if ($('fileChipMeta')) $('fileChipMeta').textContent = '';
    if ($('photoPreview')) $('photoPreview').innerHTML = '<p class="mk-photo__empty">Фото страницы, скриншот или скан — текст распознаётся и переводится.</p>';
  }

  function bindDownloads() {
    $('copyBtn')?.addEventListener('click', async () => {
      const text = $('resultText')?.textContent || '';
      if (!text) return;
      try { await navigator.clipboard.writeText(text); }
      catch (_) { showError('Не удалось открыть буфер обмена. Выделите текст результата и скопируйте вручную.'); }
    });
    $('downloadBtn')?.addEventListener('click', () => {
      const text = $('resultText')?.textContent || '';
      if (!text) return;
      const blob = new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mirror-info-translation.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const fileInput = $('fileInput');
    const galleryInput = $('galleryInput');
    const dropZone = $('dropZone');
    const textInput = $('textInput');
    const translateBtn = $('translateBtn');

    bindDownloads();

    async function chooseFile(file, isPhoto = false) {
      if (!file) return;
      clearError();
      selectedFile = file;
      selectedFileText = '';
      updateFileChip(file);
      if (isPhoto || file.type.startsWith('image/')) previewImage(file);
      progress(3, 'Проверяем файл…');
      try {
        selectedFileText = await extractFile(file);
        if (!selectedFileText.trim()) throw new Error('Текст не найден. Возможно, скан нечёткий или защищён от копирования. Попробуйте более чёткое изображение.');
        if (textInput) textInput.value = selectedFileText;
        progress(100, 'Файл прочитан. Можно переводить.');
        setTimeout(hideProgress, 900);
      } catch (error) {
        hideProgress();
        showError(error.message || 'Не удалось прочитать файл.');
      }
    }

    fileInput?.addEventListener('change', () => chooseFile(fileInput.files?.[0]));
    galleryInput?.addEventListener('change', () => chooseFile(galleryInput.files?.[0], true));
    $('pickGalleryBtn')?.addEventListener('click', () => galleryInput?.click());
    $('fileRemove')?.addEventListener('click', clearSelection);

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput?.click();
      }
    });
    ['dragenter','dragover'].forEach((name) => dropZone?.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.add('is-dragover');
    }));
    ['dragleave','drop'].forEach((name) => dropZone?.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragover');
    }));
    dropZone?.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) chooseFile(file);
    });

    $('clearBtn')?.addEventListener('click', () => {
      clearSelection();
      if (textInput) textInput.value = '';
      clearError();
      $('resultWrap')?.classList.add('hidden');
      hideProgress();
    });

    translateBtn?.addEventListener('click', async () => {
      clearError();
      let source = (textInput?.value || '').trim();
      if (!source && selectedFileText) source = selectedFileText.trim();
      if (!source) {
        showError('Сначала загрузите файл или введите текст.');
        return;
      }
      translateBtn.disabled = true;
      try {
        progress(70, 'Подготавливаем перевод…');
        const result = await translateInParts(source);
        showResult(selectedFile, result);
        progress(100, 'Перевод готов.');
        setTimeout(hideProgress, 800);
      } catch (error) {
        hideProgress();
        showError(error.message || 'Сервис перевода временно недоступен. Попробуйте позже.');
      } finally {
        translateBtn.disabled = false;
      }
    });
  });
})();
                                   
