(function () {
  'use strict';

  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_TEXT_CHARS = 100_000;
  const TRANSLATION_CHUNK_CHARS = 4000;
  const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'srt', 'vtt', 'log', 'ini', 'yml', 'yaml', 'rtf']);
  const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, 'docx', 'epub', 'fb2', 'pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
  const CDN = {
    mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
  };
  const loadedScripts = new Map();
  let selectedFile = null;
  let ocrWorkerPromise = null;

  function byId(id) { return document.getElementById(id); }

  function setError(message) {
    const wrap = byId('errorWrap');
    const text = byId('errorText');
    if (!wrap || !text) return;
    text.textContent = message || 'Произошла ошибка. Попробуйте ещё раз.';
    wrap.classList.remove('hidden');
  }

  function clearError() {
    const wrap = byId('errorWrap');
    if (wrap) wrap.classList.add('hidden');
  }

  function setProgress(percent, label) {
    const wrap = byId('progressWrap');
    const bar = byId('progressBar');
    const labelEl = byId('progressLabel');
    const percentEl = byId('progressPercent');
    if (!wrap || !bar || !labelEl || !percentEl) return;
    wrap.classList.remove('hidden');
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    labelEl.textContent = label || 'Готовим перевод…';
    percentEl.textContent = `${Math.round(percent)}%`;
  }

  function hideProgress() {
    const wrap = byId('progressWrap');
    if (wrap) wrap.classList.add('hidden');
  }

  function showResult(metaText, translatedText, sourceKind = 'text') {
    const wrap = byId('resultWrap');
    const meta = byId('resultMeta');
    const text = byId('resultText');
    const note = byId('resultNote');
    if (!wrap || !meta || !text || !note) return;

    meta.textContent = metaText || '';
    text.textContent = translatedText || '';

    if (sourceKind === 'pdf' || sourceKind === 'scan' || sourceKind === 'image') {
      note.textContent = (sourceKind === 'image' || sourceKind === 'scan') ? 'Переведённое изображение доступно для скачивания. Исходная фотография сохранена; фон под распознанным текстом восстанавливается приближённо, поэтому проверьте мелкие детали.' : 'PDF пока переводится как извлечённый текст. Для сохранения исходной PDF-вёрстки требуется отдельный этап сборки PDF.';
    } else if (sourceKind === 'docx' || sourceKind === 'epub' || sourceKind === 'fb2') {
      note.textContent = 'Переведённый DOCX/EPUB собирается на основе исходного файла: изображения, обложки, таблицы, стили и ресурсы сохраняются. Проверьте переносы строк и форматирование отдельных фрагментов после перевода.';
    } else {
      note.textContent = 'Перевод готов. Его можно скопировать или скачать как текстовый файл.';
    }

    wrap.classList.remove('hidden');
  }

  function extensionOf(file) {
    const parts = (file.name || '').toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  function loadScript(key) {
    if (loadedScripts.has(key)) return loadedScripts.get(key);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CDN[key];
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loadedScripts.delete(key);
        reject(new Error('Не удалось загрузить компонент обработки файла. Проверьте подключение к интернету и попробуйте ещё раз.'));
      };
      document.head.appendChild(script);
    });
    loadedScripts.set(key, promise);
    return promise;
  }

  function enforceTextLimit(text) {
    const value = String(text || '').replace(/\u0000/g, '').trim();
    if (!value) throw new Error('В файле не найден текст для перевода. Возможно, PDF — это скан без текстового слоя.');
    if (value.length > MAX_TEXT_CHARS) {
      throw new Error(`В документе слишком много текста (${value.length.toLocaleString('ru-RU')} символов). Максимум — ${MAX_TEXT_CHARS.toLocaleString('ru-RU')} символов за один раз.`);
    }
    return value;
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Не удалось прочитать файл. Попробуйте сохранить его в UTF-8 и загрузить снова.'));
      reader.readAsText(file);
    });
  }

  function readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
      reader.readAsArrayBuffer(file);
    });
  }

  function htmlToText(source) {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
    return doc.body.textContent || doc.documentElement.textContent || '';
  }

  function rtfToText(source) {
    return source
      .replace(/\\'[0-9a-f]{2}/gi, ' ')
      .replace(/\\par[d]?\b/g, '\n')
      .replace(/\\tab\b/g, '\t')
      .replace(/\\u(-?\d+)\??/g, (_, code) => String.fromCharCode((Number(code) + 65536) % 65536))
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '')
      .replace(/\\\\/g, '\\')
      .replace(/\\([{}])/g, '$1');
  }

  async function extractPdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF-движок не загружен. Обновите страницу и попробуйте ещё раз.');
    const pdfjs = window.pdfjsLib;
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
    const data = new Uint8Array(await readAsArrayBuffer(file));
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setProgress(8 + (pageNumber / pdf.numPages) * 22, `Читаем PDF: страница ${pageNumber} из ${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || '').join(' '));
      if (pages.join('\n').length > MAX_TEXT_CHARS) throw new Error(`В документе слишком много текста. Максимум — ${MAX_TEXT_CHARS.toLocaleString('ru-RU')} символов.`);
    }
    return pages.join('\n\n');
  }

  async function extractDocx(file) {
    await loadScript('mammoth');
    if (!window.mammoth) throw new Error('Не удалось запустить обработчик DOCX.');
    const result = await window.mammoth.extractRawText({ arrayBuffer: await readAsArrayBuffer(file) });
    return result.value || '';
  }

  async function extractEpub(file) {
    await loadScript('jszip');
    if (!window.JSZip) throw new Error('Не удалось запустить обработчик EPUB.');
    const zip = await window.JSZip.loadAsync(await readAsArrayBuffer(file));
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('Файл EPUB повреждён или не содержит container.xml.');
    const container = new DOMParser().parseFromString(await containerFile.async('text'), 'application/xml');
    if (container.querySelector('parsererror')) throw new Error('Не удалось прочитать структуру EPUB.');
    const rootfile = container.querySelector('rootfile');
    const opfPath = rootfile?.getAttribute('full-path');
    if (!opfPath) throw new Error('В EPUB не найден основной файл книги.');
    const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('text'), 'application/xml');
    const manifest = new Map(Array.from(opf.querySelectorAll('manifest item')).map((item) => [item.getAttribute('id'), item.getAttribute('href')]));
    const spine = Array.from(opf.querySelectorAll('spine itemref')).map((item) => manifest.get(item.getAttribute('idref'))).filter(Boolean);
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const sections = [];
    for (const href of spine) {
      const path = `${base}${href}`.replace(/\/[^/]+\/\.\.\//g, '/');
      const entry = zip.file(path) || zip.file(decodeURIComponent(path));
      if (!entry) continue;
      sections.push(htmlToText(await entry.async('text')));
      if (sections.join('\n').length > MAX_TEXT_CHARS) throw new Error(`В книге слишком много текста. Максимум — ${MAX_TEXT_CHARS.toLocaleString('ru-RU')} символов.`);
    }
    return sections.join('\n\n');
  }

  async function getOcrWorker() {
    if (!ocrWorkerPromise) {
      ocrWorkerPromise = (async () => {
        await loadScript('tesseract');
        if (!window.Tesseract) throw new Error('Не удалось запустить распознавание текста на изображении.');
        return window.Tesseract.createWorker('rus+eng', 1, {
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
          corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
          langPath: 'https://tessdata.projectnaptha.com/4.0.0',
          logger: (event) => {
            if (event.status === 'recognizing text') setProgress(12 + event.progress * 25, 'Распознаём текст на изображении…');
          }
        });
      })().catch((error) => {
        ocrWorkerPromise = null;
        throw error;
      });
    }
    return ocrWorkerPromise;
  }

  async function extractImage(file) {
    const worker = await getOcrWorker();
    const result = await worker.recognize(file);
    lastOcrLines = (result.data.lines || []).filter((line) => line.text && line.text.trim() && line.bbox);
    return result.data.text || '';
  }

  async function extractFileText(file) {
    if (!file) throw new Error('Сначала выберите файл.');
    if (file.size > MAX_FILE_BYTES) throw new Error('Файл слишком большой. Максимальный размер — 25 МБ.');
    const extension = extensionOf(file);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error(`Формат .${extension || 'без расширения'} не поддерживается. В текущей версии поддерживаются TXT, MD, DOCX, EPUB, FB2, PDF и изображения JPG/PNG/WEBP/GIF.`);
    }

    let text;
    const sourceKind = extension;

    if (TEXT_EXTENSIONS.has(extension)) {
      text = await readAsText(file);
      if (extension === 'html' || extension === 'htm') text = htmlToText(text);
      if (extension === 'rtf') text = rtfToText(text);
    } else if (extension === 'docx') {
      text = await extractDocx(file);
    } else if (extension === 'epub') {
      text = await extractEpub(file);
    } else if (extension === 'fb2') {
      const xml = new DOMParser().parseFromString(await readAsText(file), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('Не удалось прочитать FB2: проверьте, что файл не повреждён.');
      text = xml.documentElement.textContent || '';
    } else if (extension === 'pdf') {
      text = await extractPdf(file);
    } else {
      text = await extractImage(file);
    }

    return { text: enforceTextLimit(text), sourceKind };
  }

  function splitForTranslation(text) {
    const chunks = [];
    let remaining = text.trim();
    while (remaining.length > TRANSLATION_CHUNK_CHARS) {
      let cut = remaining.lastIndexOf('\n', TRANSLATION_CHUNK_CHARS);
      if (cut < TRANSLATION_CHUNK_CHARS * 0.55) cut = remaining.lastIndexOf(' ', TRANSLATION_CHUNK_CHARS);
      if (cut < TRANSLATION_CHUNK_CHARS * 0.55) cut = TRANSLATION_CHUNK_CHARS;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  async function translateText(text) {
    if (!window.AppAPI || typeof window.AppAPI.translate !== 'function') {
      throw new Error('Сервис перевода не загружен. Обновите страницу и попробуйте ещё раз.');
    }
    const sourceLang = byId('srcLang')?.value || 'auto';
    const targetLang = byId('tgtLang')?.value || 'ru';
    const chunks = splitForTranslation(text);
    const results = [];
    for (let index = 0; index < chunks.length; index += 1) {
      setProgress(40 + ((index + 1) / chunks.length) * 55, `Переводим фрагмент ${index + 1} из ${chunks.length}…`);
      results.push(await window.AppAPI.translate(chunks[index], sourceLang, targetLang));
    }
    return results.join('\n');
  }

  function updateFileChip(file) {
    const chip = byId('fileChip');
    const name = byId('fileChipName');
    const meta = byId('fileChipMeta');
    if (name) name.textContent = file.name;
    if (meta) meta.textContent = `${(file.size / 1024).toFixed(1)} КБ`;
    chip?.classList.remove('is-hidden');
  }

  function setFile(file, target = 'file') {
    if (!file) return;
    selectedFile = file;
    translatedAssetBlob = null;
    translatedAssetName = '';
    lastOcrLines = [];
    clearError();
    updateFileChip(file);
    const textInput = byId('textInput');
    const preview = byId('photoPreview');
    const isImage = file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(extensionOf(file));
    if (isImage && preview) {
      const image = document.createElement('img');
      image.alt = 'Предпросмотр изображения';
      image.style.cssText = 'max-height:260px;max-width:100%;border-radius:16px;object-fit:contain';
      image.src = URL.createObjectURL(file);
      image.onload = () => URL.revokeObjectURL(image.src);
      preview.replaceChildren(image);
    }
    setProgress(5, 'Читаем выбранный файл…');
    extractFileText(file).then(({ text, sourceKind }) => {
      if (textInput) textInput.value = text;
      hideProgress();
      if (target === 'photo') {
        setProgress(35, 'Текст распознан. Нажмите «Перевести документ».');
      }
      if (sourceKind === 'pdf') {
        setError('Подсказка: PDF пока переводится как извлечённый текст; сохранение исходной PDF-вёрстки будет отдельным этапом.');
      }
    }).catch((error) => {
      hideProgress();
      setError(error.message || 'Не удалось прочитать файл.');
    });
  }

  function clearSelectedFile() {
    selectedFile = null;
    translatedAssetBlob = null;
    translatedAssetName = '';
    lastOcrLines = [];
    const fileInput = byId('fileInput');
    const galleryInput = byId('galleryInput');
    if (fileInput) fileInput.value = '';
    if (galleryInput) galleryInput.value = '';
    byId('fileChip')?.classList.add('is-hidden');
    if (byId('fileChipName')) byId('fileChipName').textContent = '';
    if (byId('fileChipMeta')) byId('fileChipMeta').textContent = '';
  }



  let translatedAssetBlob = null;
  let translatedAssetName = '';
  let lastOcrLines = [];

  function setTranslatedAsset(blob, file, extension) {
    translatedAssetBlob = blob;
    const baseName = (file.name || 'translated-file').replace(/\.[^.]+$/, '');
    translatedAssetName = baseName + '.translated.' + extension;
  }

  function distributeTranslatedText(text, nodes) {
    if (!nodes.length) return;
    const originalWeights = nodes.map((node) => Math.max(1, (node.textContent || '').length));
    const totalWeight = originalWeights.reduce((sum, value) => sum + value, 0);
    const tokens = String(text || '').match(/\S+\s*/g) || [];
    const buckets = nodes.map(() => '');
    const translatedLength = tokens.reduce((sum, token) => sum + token.length, 0);
    let tokenIndex = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      const target = i === nodes.length - 1 ? Infinity : translatedLength * originalWeights[i] / totalWeight;
      let assigned = 0;
      while (tokenIndex < tokens.length && (assigned < target || i === nodes.length - 1)) {
        const token = tokens[tokenIndex++];
        buckets[i] += token;
        assigned += token.length;
        if (i !== nodes.length - 1 && assigned >= target) break;
      }
    }
    nodes.forEach((node, index) => {
      node.textContent = buckets[index];
      if (/^\s|\s$/.test(buckets[index])) {
        node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      }
    });
  }

  async function translateXmlBlocks(xmlText, selectors, label, collectedText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Не удалось разобрать структуру ' + label + '.');
    const elements = Array.from(doc.querySelectorAll(selectors)).filter((element) => {
      if (element.closest('script,style,pre,code')) return false;
      return !Array.from(element.children).some((child) => child.matches(selectors));
    });
    const serializer = new XMLSerializer();
    let completed = 0;
    for (const element of elements) {
      const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.trim()) nodes.push(node);
      }
      const original = nodes.map((item) => item.textContent).join('');
      if (!original.trim()) continue;
      const leading = original.match(/^\s*/)?.[0] || '';
      const trailing = original.match(/\s*$/)?.[0] || '';
      const translated = await translateText(original.trim());
      if (collectedText) collectedText.push(translated);
      distributeTranslatedText(leading + translated + trailing, nodes);
      completed += 1;
      setProgress(42 + Math.min(48, completed * 0.35), 'Переводим элементы ' + label + ': ' + completed + '…');
    }
    return serializer.serializeToString(doc);
  }

  async function translateDocxPackage(file) {
    await loadScript('jszip');
    const zip = await window.JSZip.loadAsync(await readAsArrayBuffer(file));
    const xmlEntries = zip.file(/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/i);
    if (!xmlEntries.length) throw new Error('В DOCX не найдена основная структура Word.');
    const translatedPreview = [];
    for (const entry of xmlEntries) {
      const xml = await entry.async('text');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Не удалось прочитать ' + entry.name + '.');
      const paragraphs = Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p'));
      for (let index = 0; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs[index];
        const textNodes = Array.from(paragraph.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't'));
        const source = textNodes.map((node) => node.textContent || '').join('');
        if (!source.trim()) continue;
        const leading = source.match(/^\s*/)?.[0] || '';
        const trailing = source.match(/\s*$/)?.[0] || '';
        const translated = await translateText(source.trim());
        translatedPreview.push(translated);
        distributeTranslatedText(leading + translated + trailing, textNodes);
        setProgress(42 + (paragraphs.length ? (index + 1) / paragraphs.length * 48 : 0), 'Сохраняем оформление Word: ' + entry.name + '…');
      }
      zip.file(entry.name, new XMLSerializer().serializeToString(doc));
    }
    return {
      blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      text: translatedPreview.join('\n\n') || 'В DOCX не найдено текста для перевода.'
    };
  }

  async function translateEpubPackage(file) {
    await loadScript('jszip');
    const zip = await window.JSZip.loadAsync(await readAsArrayBuffer(file));
    const entries = zip.file(/\.(xhtml|html|htm)$/i).filter((entry) => !entry.dir);
    if (!entries.length) throw new Error('В EPUB не найдены XHTML/HTML главы.');
    const selector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,figcaption,caption,dt,dd';
    let translatedFiles = 0;
    const translatedPreview = [];
    for (const entry of entries) {
      const xml = await entry.async('text');
      const updated = await translateXmlBlocks(xml, selector, 'главы EPUB', translatedPreview);
      zip.file(entry.name, updated);
      translatedFiles += 1;
    }
    return {
      blob: await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' }),
      text: translatedPreview.join('\n\n') || 'В EPUB не найдено текста для перевода.'
    };
  }

  function samplePatchColor(context, box, width, height) {
    const x0 = Math.max(0, Math.floor(box.x0));
    const x1 = Math.min(width, Math.ceil(box.x1));
    const y0 = Math.max(0, Math.floor(box.y0));
    const y1 = Math.min(height, Math.ceil(box.y1));
    const samples = [];
    const step = Math.max(2, Math.floor((x1 - x0) / 8));
    for (let x = x0; x < x1; x += step) {
      for (const y of [Math.max(0, y0 - 2), Math.min(height - 1, y1 + 2)]) {
        const pixel = context.getImageData(x, y, 1, 1).data;
        samples.push([pixel[0], pixel[1], pixel[2]]);
      }
    }
    if (!samples.length) return 'rgba(255,255,255,0.94)';
    const average = [0, 1, 2].map((channel) => Math.round(samples.reduce((sum, pixel) => sum + pixel[channel], 0) / samples.length));
    return 'rgba(' + average[0] + ',' + average[1] + ',' + average[2] + ',0.96)';
  }

  async function translateImageFile(file) {
    const worker = await getOcrWorker();
    let lines = lastOcrLines;
    if (!lines.length) {
      const result = await worker.recognize(file);
      lines = (result.data.lines || []).filter((line) => line.text && line.text.trim() && line.bbox);
    }
    if (!lines.length) throw new Error('OCR распознал текст, но не вернул координаты строк. Попробуйте более чёткое JPG/PNG-изображение.');
    const translatedLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      translatedLines.push(await translateText(lines[index].text.trim()));
      setProgress(45 + ((index + 1) / lines.length) * 40, 'Переводим строки на изображении: ' + (index + 1) + ' из ' + lines.length + '…');
    }
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось открыть исходное изображение.'));
        image.src = objectUrl;
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    if (image.naturalWidth * image.naturalHeight > 32000000) {
      throw new Error('Изображение слишком большое для безопасной обработки в браузере. Уменьшите его размер и загрузите снова.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Не удалось подготовить изображение для перевода.');
    context.drawImage(image, 0, 0);
    lines.forEach((line, index) => {
      const box = line.bbox;
      const x = Math.max(0, box.x0);
      const y = Math.max(0, box.y0);
      const width = Math.min(canvas.width - x, Math.max(1, box.x1 - box.x0));
      const height = Math.min(canvas.height - y, Math.max(1, box.y1 - box.y0));
      context.fillStyle = samplePatchColor(context, box, canvas.width, canvas.height);
      context.fillRect(x - 2, y - 1, width + 4, height + 2);
      let fontSize = Math.max(9, Math.min(36, height * 0.78));
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = '600 ' + fontSize + 'px Arial, sans-serif';
      while (fontSize > 8 && context.measureText(translatedLines[index]).width > width + 2) {
        fontSize -= 1;
        context.font = '600 ' + fontSize + 'px Arial, sans-serif';
      }
      context.fillStyle = '#202020';
      context.fillText(translatedLines[index], x + width / 2, y + height / 2, Math.max(1, width));
    });
    const extension = extensionOf(file);
    const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/png';
    const outputExtension = mime === 'image/jpeg' ? 'jpg' : 'png';
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Не удалось сформировать переведённое изображение.')), mime, 0.94));
    setTranslatedAsset(blob, file, outputExtension);
    return { blob, text: translatedLines.join('\n') };
  }

  function showTranslatedAssetPreview(blob) {
    const pane = byId('resultPane');
    if (!pane || !blob) return;
    let preview = byId('resultAssetPreview');
    if (!preview) {
      preview = document.createElement('img');
      preview.id = 'resultAssetPreview';
      preview.alt = 'Предпросмотр переведённого файла';
      preview.style.cssText = 'display:block;max-width:100%;max-height:560px;object-fit:contain;margin:0 auto 16px;border-radius:12px';
      pane.prepend(preview);
    }
    if (preview.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    const url = URL.createObjectURL(blob);
    preview.src = url;
    preview.dataset.objectUrl = url;
  }

  function bindCopyDownload() {
    byId('copyBtn')?.addEventListener('click', async () => {
      const text = byId('resultText')?.textContent || '';
      if (!text.trim()) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        setError('Буфер обмена недоступен. Выделите текст результата и скопируйте его вручную.');
      }
    });
    byId('downloadBtn')?.addEventListener('click', () => {
      const text = byId('resultText')?.textContent || '';
      if (translatedAssetBlob) {
        const url = URL.createObjectURL(translatedAssetBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = translatedAssetName || 'mirror-translation';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        return;
      }
      if (!text.trim()) return;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mirror-translation.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    byId('viewBtn')?.addEventListener('click', () => byId('resultPane')?.classList.toggle('is-expanded'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const fileInput = byId('fileInput');
    const galleryInput = byId('galleryInput');
    const textInput = byId('textInput');
    const dropZone = byId('dropZone');
    const filePanel = byId('panelFile');
    const textPanel = byId('panelText');
    const photoPanel = byId('panelPhoto');
    const photoPreview = byId('photoPreview');
    const translateBtn = byId('translateBtn');

    bindCopyDownload();

    document.querySelectorAll('#modeTabs [data-mode]').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#modeTabs [data-mode]').forEach((item) => {
          const active = item === tab;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-pressed', String(active));
        });
        const mode = tab.dataset.mode;
        filePanel?.classList.toggle('hidden', mode !== 'file');
        textPanel?.classList.toggle('hidden', mode !== 'text');
        photoPanel?.classList.toggle('hidden', mode !== 'photo');
      });
    });

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput?.click();
      }
    });
    ['dragenter', 'dragover'].forEach((eventName) => dropZone?.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('is-dragover');
    }));
    ['dragleave', 'drop'].forEach((eventName) => dropZone?.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragover');
    }));
    dropZone?.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) setFile(file);
    });

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) setFile(file);
    });
    byId('pickGalleryBtn')?.addEventListener('click', () => galleryInput?.click());
    galleryInput?.addEventListener('change', () => {
      const file = galleryInput.files?.[0];
      if (file) setFile(file, 'photo');
    });
    byId('fileRemove')?.addEventListener('click', () => {
      clearSelectedFile();
      if (textInput) textInput.value = '';
      clearError();
    });

    byId('clearBtn')?.addEventListener('click', () => {
      if (textInput) textInput.value = '';
      clearSelectedFile();
      clearError();
      hideProgress();
      byId('resultWrap')?.classList.add('hidden');
      if (photoPreview) {
        const paragraph = document.createElement('p');
        paragraph.className = 'mk-photo__empty';
        paragraph.textContent = 'Фото страницы, скриншот или скан — текст распознаётся и переводится. Снимайте страницу целиком, без наклона.';
        photoPreview.replaceChildren(paragraph);
      }
    });

    translateBtn?.addEventListener('click', async () => {
      clearError();
      const sourceText = (textInput?.value || '').trim();
      if (!sourceText && selectedFile) {
        setError('Файл ещё обрабатывается. Подождите немного и нажмите снова.');
        return;
      }
      if (!sourceText) {
        setError('Выберите файл или введите текст для перевода.');
        return;
      }
      translateBtn.disabled = true;
      setProgress(35, 'Подготавливаем перевод…');
      try {
        const sourceKind = selectedFile ? extensionOf(selectedFile) : 'text';
        let translated;
        let translatedAsset = null;
        if (selectedFile && sourceKind === 'docx') {
          const packageResult = await translateDocxPackage(selectedFile);
          translatedAsset = packageResult.blob;
          translated = packageResult.text;
          setTranslatedAsset(translatedAsset, selectedFile, 'docx');
        } else if (selectedFile && sourceKind === 'epub') {
          const packageResult = await translateEpubPackage(selectedFile);
          translatedAsset = packageResult.blob;
          translated = packageResult.text;
          setTranslatedAsset(translatedAsset, selectedFile, 'epub');
        } else if (selectedFile && ['jpg', 'jpeg', 'png'].includes(sourceKind)) {
          const imageResult = await translateImageFile(selectedFile);
          translatedAsset = imageResult.blob;
          translated = imageResult.text;
        } else {
          translated = await translateText(enforceTextLimit(sourceText));
        }
        setProgress(100, 'Перевод готов.');
        const normalizedKind = sourceKind === 'pdf' ? 'pdf' : sourceKind === 'docx' ? 'docx' : sourceKind === 'epub' ? 'epub' : sourceKind === 'fb2' ? 'fb2' : (sourceKind === 'jpg' || sourceKind === 'jpeg' || sourceKind === 'png' || sourceKind === 'webp' || sourceKind === 'gif' || sourceKind === 'bmp') ? 'scan' : 'text';
        showResult(`${byId('srcLang')?.value || 'auto'} → ${byId('tgtLang')?.value || 'ru'}`, translated, normalizedKind);
        if (translatedAsset) showTranslatedAssetPreview(translatedAsset);
        setTimeout(hideProgress, 500);
      } catch (error) {
        hideProgress();
        setError(error.message || 'Не удалось перевести текст. Попробуйте ещё раз.');
      } finally {
        translateBtn.disabled = false;
      }
    });
  });
})();
