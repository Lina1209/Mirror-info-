/* Mirror-info — надёжная обработка и перевод документов.
 * TXT / MD / CSV / JSON / XML / HTML / RTF
 * DOCX / EPUB / FB2 / PDF / изображения
 * OCR: Tesseract.js
 */
(function () {
  'use strict';

  const OCR_LANG = 'rus+eng';
  const OCR_LANGUAGES = {
    en: 'eng', ru: 'rus', kk: 'kaz', uk: 'ukr', de: 'deu',
    fr: 'fra', es: 'spa', it: 'ita', tr: 'tur',
    'zh-CN': 'chi_sim', ja: 'jpn', ko: 'kor', ar: 'ara'
  };
  const MAX_CHUNK_LENGTH = 900;
  const REQUEST_DELAY = 350;
  const MAX_RETRIES = 3;

  let selectedFileText = '';
  let selectedFile = null;
  let ocrWorkerPromise = null;
  let ocrWorkerLanguage = '';
  let lastOcrLanguage = '';
  let lastOcrFile = null;
  let pdfUnicodeFontPromise = null;
  let lastPdfTextLayerStatus = 'not-started';

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

    if ($('progressBar')) {
      $('progressBar').style.width =
        `${Math.max(0, Math.min(100, percent))}%`;
    }

    if ($('progressPercent')) {
      $('progressPercent').textContent =
        `${Math.round(percent)}%`;
    }

    if ($('progressLabel')) {
      $('progressLabel').textContent = label;
    }
  }

  function hideProgress() {
    $('progressWrap')?.classList.add('hidden');
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Загрузка внешних библиотек
  function loadScript(src, test) {
    if (test()) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const existing = [...document.scripts]
        .find(script => script.src === src);

      if (existing) {
        if (test()) {
          resolve();
          return;
        }

        existing.addEventListener('load', resolve, { once: true });

        existing.addEventListener('error', () => {
          reject(new Error(
            'Не удалось загрузить библиотеку обработки файла.'
          ));
        }, { once: true });

        return;
      }

      const script = document.createElement('script');

      script.src = src;
      script.async = true;

      script.onload = resolve;

      script.onerror = () => {
        reject(new Error(
          'Не удалось загрузить компонент обработки документа. ' +
          'Проверьте интернет-соединение и попробуйте ещё раз.'
        ));
      };

      document.head.appendChild(script);
    });
  }

  async function ensurePdfJs() {
    await loadScript(
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
      () => !!window.pdfjsLib
    );

    if (!window.pdfjsLib) {
      throw new Error('Компонент чтения PDF не загрузился.');
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    return window.pdfjsLib;
  }


  async function ensureJsPdf() {
    await loadScript(
      'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js',
      () => !!window.jspdf?.jsPDF
    );

    if (!window.jspdf?.jsPDF) {
      throw new Error('Компонент сборки PDF не загрузился.');
    }

    return window.jspdf.jsPDF;
  }

  async function loadPdfUnicodeFont() {
    if (!pdfUnicodeFontPromise) {
      pdfUnicodeFontPromise = (async () => {
        const response = await fetch(
          'https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf',
          { mode: 'cors' }
        );
        if (!response.ok) {
          throw new Error('Не удалось загрузить шрифт для текстового слоя PDF.');
        }

        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        const chunkSize = 8192;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return btoa(binary);
      })().catch(error => {
        pdfUnicodeFontPromise = null;
        throw error;
      });
    }

    return pdfUnicodeFontPromise;
  }

  function registerPdfUnicodeFont(pdf, fontData) {
    if (!pdf.__mirrorUnicodeFontRegistered) {
      pdf.addFileToVFS('NotoSans-Regular.ttf', fontData);
      pdf.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
      pdf.__mirrorUnicodeFontRegistered = true;
    }
    pdf.setFont('NotoSans', 'normal');
  }

  async function ensureMammoth() {
    await loadScript(
      'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js',
      () => !!window.mammoth
    );

    if (!window.mammoth) {
      throw new Error('Компонент чтения DOCX не загрузился.');
    }

    return window.mammoth;
  }

  async function ensureJSZip() {
    await loadScript(
      'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
      () => !!window.JSZip
    );

    if (!window.JSZip) {
      throw new Error('Компонент чтения EPUB не загрузился.');
    }

    return window.JSZip;
  }

  async function ensureTesseract() {
    await loadScript(
      'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      () => !!window.Tesseract
    );

    if (!window.Tesseract) {
      throw new Error('Компонент распознавания сканов не загрузился.');
    }

    const selectedLanguage = $('srcLang')?.value || 'auto';
    const language = selectedLanguage === 'auto'
      ? OCR_LANG
      : (OCR_LANGUAGES[selectedLanguage] || OCR_LANG);

    if (!ocrWorkerPromise || ocrWorkerLanguage !== language) {
      if (ocrWorkerPromise) {
        try {
          const oldWorker = await ocrWorkerPromise;
          await oldWorker.terminate();
        } catch (_) {}
      }

      ocrWorkerLanguage = language;
      ocrWorkerPromise = window.Tesseract.createWorker(
        language,
        1,
        {
          logger: event => {
            if (
              event.status === 'recognizing text' &&
              event.progress
            ) {
              progress(
                35 + event.progress * 35,
                'Распознаём текст на скане…'
              );
            }
          }
        }
      ).catch(error => {
        ocrWorkerPromise = null;
        ocrWorkerLanguage = '';
        throw error;
      });
    }

    return ocrWorkerPromise;
  }

  function extension(file) {
    return (file.name.split('.').pop() || '').toLowerCase();
  }

  function updateFileChip(file) {
    if ($('fileChip')) {
      $('fileChip').classList.remove('is-hidden');
    }

    if ($('fileChipName')) {
      $('fileChipName').textContent = file.name;
    }

    if ($('fileChipMeta')) {
      $('fileChipMeta').textContent =
        `${(file.size / 1024 / 1024).toFixed(2)} МБ · ` +
        `${file.type || 'тип определён по расширению'}`;
    }
  }

  function previewImage(file) {
    const target = $('photoPreview');
    if (!target) return;

    const previousUrl = target.dataset.objectUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    target.replaceChildren();

    const url = URL.createObjectURL(file);
    target.dataset.objectUrl = url;

    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Предпросмотр загруженного изображения';
    img.style.cssText =
      'max-width:100%;max-height:280px;' +
      'object-fit:contain;border-radius:14px;';

    const releaseUrl = () => {
      if (target.dataset.objectUrl === url) {
        URL.revokeObjectURL(url);
        delete target.dataset.objectUrl;
      }
    };
    img.onload = releaseUrl;
    img.onerror = releaseUrl;
    target.appendChild(img);
  }

  // Чтение обычного текста
  async function readText(file) {
    const buffer = await file.arrayBuffer();

    try {
      return new TextDecoder('utf-8', {
        fatal: true
      }).decode(buffer);
    } catch (_) {
      try {
        return new TextDecoder('windows-1251').decode(buffer);
      } catch (_) {
        throw new Error(
          'Не удалось определить кодировку. ' +
          'Сохраните документ в UTF-8 и загрузите снова.'
        );
      }
    }
  }

  // Чтение Word
  async function readDocx(file) {
    const mammoth = await ensureMammoth();

    const result = await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer()
    });

    return result.value || '';
  }

  // Чтение FB2
  async function readFb2(file) {
    const xml = await readText(file);

    const doc = new DOMParser().parseFromString(
      xml,
      'application/xml'
    );

    if (doc.querySelector('parsererror')) {
      throw new Error(
        'Файл FB2 повреждён или содержит некорректный XML.'
      );
    }

    return [
      ...doc.querySelectorAll(
        'body, title, annotation, epigraph, section'
      )
    ]
      .map(node => node.textContent.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  // Чтение EPUB
  async function readEpub(file) {
    const JSZip = await ensureJSZip();

    const zip = await JSZip.loadAsync(
      await file.arrayBuffer()
    );

    const containerFile = zip.file(
      'META-INF/container.xml'
    );

    if (!containerFile) {
      throw new Error(
        'В EPUB отсутствует файл META-INF/container.xml.'
      );
    }

    const container = new DOMParser().parseFromString(
      await containerFile.async('text'),
      'application/xml'
    );

    const rootfile = container
      .querySelector('rootfile')
      ?.getAttribute('full-path');

    if (!rootfile) {
      throw new Error(
        'Не удалось найти структуру книги EPUB.'
      );
    }

    const opfFile = zip.file(rootfile);

    if (!opfFile) {
      throw new Error(
        'В EPUB отсутствует файл описания книги.'
      );
    }

    const opf = new DOMParser().parseFromString(
      await opfFile.async('text'),
      'application/xml'
    );

    const manifest = new Map();

    opf.querySelectorAll('manifest item').forEach(item => {
      manifest.set(
        item.getAttribute('id'),
        item.getAttribute('href')
      );
    });

    const base = rootfile.includes('/')
      ? rootfile.slice(0, rootfile.lastIndexOf('/') + 1)
      : '';

    const sections = [];

    for (const item of opf.querySelectorAll('spine itemref')) {
      const href = manifest.get(
        item.getAttribute('idref')
      );

      if (!href) continue;

      let decodedHref = href;

      try {
        decodedHref = decodeURIComponent(href);
      } catch (_) {}

      const path = (
        base + decodedHref
      ).replace(/\\/g, '/');

      const entry =
        zip.file(path) ||
        zip.file(base + href);

      if (!entry) continue;

      const html = new DOMParser().parseFromString(
        await entry.async('text'),
        'text/html'
      );

      html.querySelectorAll(
        'script, style, nav'
      ).forEach(node => node.remove());

      const text = (
        html.body?.textContent || ''
      )
        .replace(/\s+/g, ' ')
        .trim();

      if (text) sections.push(text);
    }

    return sections.join('\n\n');
  }



  function collectOcrLines(data) {
    let lines = Array.isArray(data?.lines) ? data.lines : [];

    if (!lines.length && Array.isArray(data?.blocks)) {
      lines = data.blocks.flatMap(block =>
        (block.paragraphs || []).flatMap(paragraph => paragraph.lines || [])
      );
    }

    if (!lines.length && Array.isArray(data?.words)) {
      const grouped = new Map();
      data.words.forEach(word => {
        if (!word.text || !word.bbox) return;
        const key = [
          word.block_num || 0,
          word.par_num || 0,
          word.line_num || 0
        ].join(':');
        const current = grouped.get(key) || {
          text: '',
          bbox: {
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1
          }
        };
        current.text = (current.text ? current.text + ' ' : '') + word.text;
        current.bbox.x0 = Math.min(current.bbox.x0, word.bbox.x0);
        current.bbox.y0 = Math.min(current.bbox.y0, word.bbox.y0);
        current.bbox.x1 = Math.max(current.bbox.x1, word.bbox.x1);
        current.bbox.y1 = Math.max(current.bbox.y1, word.bbox.y1);
        grouped.set(key, current);
      });
      lines = Array.from(grouped.values());
    }

    return lines.filter(line =>
      line.text && line.text.trim() && line.bbox &&
      Number.isFinite(line.bbox.x0) && Number.isFinite(line.bbox.y0) &&
      Number.isFinite(line.bbox.x1) && Number.isFinite(line.bbox.y1)
    );
  }

  // OCR изображений
  async function ocrImage(source) {
    const worker = await ensureTesseract();

    const result = await worker.recognize(source);
    lastOcrLines = collectOcrLines(result.data);
    lastOcrLanguage = $('srcLang')?.value || 'auto';

    return result.data?.text || '';
  }

  // Чтение PDF
  async function readPdf(file) {
    if (file.size > 100 * 1024 * 1024) {
      throw new Error('Для чтения PDF в браузере пока поддерживаются файлы до 100 МБ.');
    }

    const pdfjs = await ensurePdfJs();
    const pdf = await pdfjs.getDocument({
      data: await file.arrayBuffer(),
      isEvalSupported: false
    }).promise;

    const pages = [];
    const MAX_PAGES = 1000;
    const MAX_EXTRACTED_TEXT = 15000000;
    let extractedLength = 0;

    try {
      if (pdf.numPages > MAX_PAGES) {
        throw new Error('В режиме чтения поддерживается до 1000 страниц за один проход. Разделите документ на части.');
      }

      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
        progress(
          5 + pageNo / pdf.numPages * 65,
          'Читаем PDF: страница ' + pageNo + ' из ' + pdf.numPages + '…'
        );

        let page = null;
        let canvas = null;

        try {
          page = await pdf.getPage(pageNo);
          const content = await page.getTextContent();

          let text = content.items
            .map(item => item.str || '')
            .join(' ')
            .replace(/[ \t]+/g, ' ')
            .trim();

          if (text.length < 25) {
            const baseViewport = page.getViewport({ scale: 1 });
            const scale = Math.min(
              1.5,
              Math.sqrt(16000000 / Math.max(1, baseViewport.width * baseViewport.height))
            );
            const viewport = page.getViewport({ scale });
            canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);

            const context = canvas.getContext('2d', {
              willReadFrequently: true
            });
            if (!context) {
              throw new Error('Не удалось подготовить страницу PDF для распознавания.');
            }

            await page.render({
              canvasContext: context,
              viewport
            }).promise;

            text = await ocrImage(canvas);
          }

          if (text) {
            extractedLength += text.length;
            if (extractedLength > MAX_EXTRACTED_TEXT) {
              throw new Error('В PDF слишком много текста для одного прохода в браузере. Разделите документ на несколько частей.');
            }
            pages.push(text);
          }
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
          if (page) {
            try {
              await page.cleanup();
            } catch (_) {
              // Не скрываем основную ошибку чтения из-за очистки.
            }
          }
        }
      }

      return pages.join('\n\n');
    } finally {
      pages.length = 0;
      try {
        await pdf.destroy();
      } catch (_) {
        // Не скрываем основную ошибку чтения из-за очистки PDF.js.
      }
    }
  }

  async function validateImageSize(file) {
    const url = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось прочитать размеры изображения.'));
        image.src = url;
      });
      const pixels = image.naturalWidth * image.naturalHeight;
      if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error('Изображение имеет некорректные размеры.');
      }
      if (pixels > 32000000) {
        throw new Error('Изображение превышает безопасный предел 32 мегапикселя. Уменьшите его размер и загрузите снова.');
      }
    } finally {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      URL.revokeObjectURL(url);
    }
  }

  // Определение формата и извлечение текста
  async function extractFile(file) {
    if (!file) {
      throw new Error('Сначала выберите файл.');
    }

    if (file.size === 0) {
      throw new Error('Выбран пустой файл.');
    }

    const ext = extension(file);

    if (
      file.type.startsWith('image/') ||
      [
        'jpg', 'jpeg', 'png', 'webp',
        'bmp', 'tif', 'tiff'
      ].includes(ext)
    ) {
      await validateImageSize(file);
      return await ocrImage(file);
    }

    if (ext === 'pdf') return await readPdf(file);
    if (ext === 'docx') return await readDocx(file);
    if (ext === 'epub') return await readEpub(file);
    if (ext === 'fb2') return await readFb2(file);

    if (
      [
        'txt', 'md', 'markdown', 'csv', 'tsv',
        'json', 'xml', 'html', 'htm',
        'srt', 'vtt', 'log', 'ini',
        'yml', 'yaml', 'rtf'
      ].includes(ext)
    ) {
      let text = await readText(file);

      if (ext === 'rtf') {
        text = text
          .replace(/\\'[0-9a-f]{2}/gi, ' ')
          .replace(/\\[a-z]+-?\d* ?/gi, ' ')
          .replace(/[{}]/g, ' ')
          .replace(/\s+/g, ' ');
      }

      return text;
    }

    throw new Error(
      `Формат .${ext || 'неизвестен'} пока не поддерживается. ` +
      'Поддерживаются PDF, DOCX, EPUB, FB2, TXT, RTF, ' +
      'MD, CSV, HTML, JSON и изображения JPG/PNG/WEBP/TIFF.'
    );
  }

  // Деление большого текста на небольшие фрагменты
  function safeTextCutIndex(text, limit) {
    const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;

    if (segmenter) {
      let boundary = 0;
      for (const part of segmenter.segment(text)) {
        const nextBoundary = part.index + part.segment.length;
        if (nextBoundary > limit) break;
        boundary = nextBoundary;
      }
      if (boundary > 0) return boundary;
      const first = segmenter.segment(text)[Symbol.iterator]().next().value;
      return first ? first.segment.length : Math.min(limit, text.length);
    }

    let boundary = Math.min(limit, text.length);
    // Не разрезаем суррогатную пару (например, emoji) пополам.
    if (
      boundary > 0 &&
      boundary < text.length &&
      /[\uD800-\uDBFF]/.test(text[boundary - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[boundary])
    ) boundary -= 1;

    return Math.max(1, boundary);
  }

  function splitText(text, maxLength = MAX_CHUNK_LENGTH) {
    const paragraphs = text.split(/\n{2,}/);

    const chunks = [];

    let current = '';

    for (const paragraph of paragraphs) {
      let part = paragraph.trim();

      if (!part) continue;

      while (part.length > maxLength) {
        if (current) {
          chunks.push(current);
          current = '';
        }

        let cut = part.lastIndexOf(' ', maxLength);

        if (cut < maxLength * 0.55) {
          cut = safeTextCutIndex(part, maxLength);
        } else {
          cut = safeTextCutIndex(part, cut);
        }

        chunks.push(part.slice(0, cut).trim());

        part = part.slice(cut).trim();
      }

      const combined = current
        ? current + '\n\n' + part
        : part;

      if (
        combined.length > maxLength &&
        current
      ) {
        chunks.push(current);
        current = part;
      } else {
        current = combined;
      }
    }

    if (current) {
      chunks.push(current);
    }

    return chunks;
  }

  // Перевод одного фрагмента с повторными попытками
  async function translateChunk(
    text,
    source,
    target
  ) {
    let lastError;

    for (
      let attempt = 1;
      attempt <= MAX_RETRIES;
      attempt++
    ) {
      try {
        return await window.AppAPI.translate(
          text,
          source,
          target
        );
      } catch (error) {
        lastError = error;

        if (attempt < MAX_RETRIES) {
          await delay(attempt * 1200);
        }
      }
    }

    if (
      lastError?.message === 'Failed to fetch' ||
      lastError instanceof TypeError
    ) {
      throw new Error(
        'Не удалось связаться с сервисом перевода. ' +
        'Проверьте интернет-соединение и попробуйте ещё раз.'
      );
    }

    throw lastError || new Error(
      'Не удалось перевести фрагмент текста.'
    );
  }

  // Перевод всего документа
  async function translateInParts(text) {
    if (!window.AppAPI?.translate) {
      throw new Error(
        'Сервис перевода пока не подключён.'
      );
    }

    const source = $('srcLang')?.value || 'auto';
    const target = $('tgtLang')?.value || 'ru';

    const chunks = splitText(text);

    if (!chunks.length) {
      throw new Error('В документе нет текста для перевода.');
    }

    const translated = [];

    for (let i = 0; i < chunks.length; i++) {
      progress(
        72 + ((i + 1) / chunks.length) * 25,
        `Переводим фрагмент ${i + 1} из ${chunks.length}…`
      );

      const result = await translateChunk(
        chunks[i],
        source,
        target
      );

      translated.push(result);

      if (i < chunks.length - 1) {
        await delay(REQUEST_DELAY);
      }
    }

    return translated.join('\n\n');
  }



  // Экспорт переведённого файла с сохранением исходного контейнера.
  let translatedAssetBlob = null;
  let translatedAssetName = '';
  let lastOcrLines = [];

  function setTranslatedAsset(blob, file, outputExtension) {
    translatedAssetBlob = blob;
    const base = (file?.name || 'mirror-info-translation').replace(/\.[^.]+$/, '');
    translatedAssetName = base + '.translated.' + outputExtension;
  }

  function distributeTranslatedText(text, nodes) {
    if (!nodes.length) return;
    const weights = nodes.map(node => Math.max(1, (node.textContent || '').length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const tokens = String(text || '').match(/\S+\s*/g) || [];
    const translatedLength = tokens.reduce((sum, token) => sum + token.length, 0);
    const buckets = nodes.map(() => '');
    let tokenIndex = 0;

    for (let index = 0; index < nodes.length; index += 1) {
      const target = index === nodes.length - 1
        ? Infinity
        : translatedLength * weights[index] / totalWeight;
      let assigned = 0;
      while (tokenIndex < tokens.length && (assigned < target || index === nodes.length - 1)) {
        const token = tokens[tokenIndex++];
        buckets[index] += token;
        assigned += token.length;
        if (index !== nodes.length - 1 && assigned >= target) break;
      }
    }

    nodes.forEach((node, index) => {
      node.textContent = buckets[index];
      if (/^\s|\s$/.test(buckets[index])) {
        node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      }
    });
  }

  async function translateXmlBlocks(xmlText, selector, label, previewParts) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('Не удалось разобрать XML-структуру: ' + label + '.');
    }

    const blocks = Array.from(doc.querySelectorAll(selector)).filter(element => {
      if (element.closest('script,style,pre,code')) return false;
      return !Array.from(element.children).some(child => child.matches(selector));
    });

    for (let index = 0; index < blocks.length; index += 1) {
      const walker = doc.createTreeWalker(blocks[index], NodeFilter.SHOW_TEXT);
      const textNodes = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.trim()) textNodes.push(node);
      }

      const source = textNodes.map(item => item.textContent).join('');
      if (!source.trim()) continue;

      const leading = source.match(/^\s*/)?.[0] || '';
      const trailing = source.match(/\s*$/)?.[0] || '';
      const translated = await translateInParts(source.trim());
      previewParts?.push(translated);
      distributeTranslatedText(leading + translated + trailing, textNodes);

      progress(
        45 + (index + 1) / Math.max(1, blocks.length) * 45,
        'Переводим ' + label + ': ' + (index + 1) + ' из ' + blocks.length + '…'
      );
    }

    return new XMLSerializer().serializeToString(doc);
  }


  async function translatePdfPackage(file) {
    if (file.size > 50 * 1024 * 1024) {
      throw new Error('Для сборки PDF с сохранением страниц пока поддерживаются файлы до 50 МБ.');
    }

    const pdfjs = await ensurePdfJs();
    const JsPDF = await ensureJsPdf();
    const targetLanguage = $('tgtLang')?.value || 'ru';
    const supportsCurrentFont = [
      'en', 'ru', 'kk', 'uk', 'de', 'fr', 'es', 'it', 'tr'
    ].includes(targetLanguage);
    let unicodeFontData = null;
    lastPdfTextLayerStatus = 'unsupported-language';

    if (supportsCurrentFont) {
      try {
        unicodeFontData = await loadPdfUnicodeFont();
        lastPdfTextLayerStatus = 'enabled';
      } catch (_) {
        lastPdfTextLayerStatus = 'font-unavailable';
      }
    }

    const sourcePdf = await pdfjs.getDocument({
      data: await file.arrayBuffer(),
      isEvalSupported: false
    }).promise;

    let outputPdf = null;
    const previewParts = [];
    let totalRasterPixels = 0;
    const MAX_TOTAL_RASTER_PIXELS = 100000000;

    try {
      if (sourcePdf.numPages > 100) {
        throw new Error('В этом режиме PDF поддерживает до 100 страниц за один проход. Разделите большой документ на части.');
      }

      for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
        progress(
          5 + (pageNumber - 1) / sourcePdf.numPages * 85,
          'Сохраняем страницу PDF ' + pageNumber + ' из ' + sourcePdf.numPages + '…'
        );

        let page = null;
        let canvas = null;

        try {
          page = await sourcePdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(
            1.5,
            Math.sqrt(16000000 / Math.max(1, baseViewport.width * baseViewport.height))
          );
          const viewport = page.getViewport({ scale });
          const pagePixels = Math.ceil(viewport.width) * Math.ceil(viewport.height);
          totalRasterPixels += pagePixels;
          if (totalRasterPixels > MAX_TOTAL_RASTER_PIXELS) {
            throw new Error(
              'Общий объём изображений PDF превышает безопасный предел обработки в браузере. ' +
              'Разделите книгу на более короткие части или уменьшите разрешение страниц.'
            );
          }

          canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);

          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) {
            throw new Error('Не удалось подготовить страницу PDF для обработки.');
          }

          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: context, viewport }).promise;

          await ocrImage(canvas);
          const lines = lastOcrLines.slice();
          const translatedLines = [];

          for (let index = 0; index < lines.length; index += 1) {
            const translated = await translateInParts(lines[index].text.trim());
            translatedLines.push(translated);
            previewParts.push(translated);

            const pageProgress = lines.length
              ? (index + 1) / lines.length
              : 1;
            progress(
              5 + ((pageNumber - 1) + pageProgress) / sourcePdf.numPages * 85,
              'Переводим страницу ' + pageNumber + ': строка ' +
              (index + 1) + ' из ' + lines.length
            );
          }

          const textOverlay = [];
          lines.forEach((line, index) => {
            const box = line.bbox;
            const x = Math.max(0, Math.floor(box.x0));
            const y = Math.max(0, Math.floor(box.y0));
            const width = Math.max(1, Math.min(canvas.width - x, Math.ceil(box.x1 - box.x0)));
            const height = Math.max(1, Math.min(canvas.height - y, Math.ceil(box.y1 - box.y0)));
            if (x >= canvas.width || y >= canvas.height) return;

            const backgroundColor = sampleBackgroundColor(
              context,
              box,
              canvas.width,
              canvas.height
            );
            context.fillStyle = backgroundColor;
            context.fillRect(
              Math.max(0, x - 2),
              Math.max(0, y - 1),
              Math.min(canvas.width - Math.max(0, x - 2), width + 4),
              Math.min(canvas.height - Math.max(0, y - 1), height + 2)
            );

            let fontSize = Math.max(5, Math.min(30, height * 0.78));
            context.font = '600 ' + fontSize + 'px Arial, sans-serif';
            context.textAlign = 'left';
            context.textBaseline = 'middle';

            while (
              fontSize > 3.5 &&
              context.measureText(translatedLines[index]).width > width + 2
            ) {
              fontSize = Math.max(3.5, fontSize - 0.5);
              context.font = '600 ' + fontSize + 'px Arial, sans-serif';
            }

            context.fillStyle = readableTextColor(backgroundColor);
            // Не сжимаем длинную строку по горизонтали: подбираем размер шрифта,
            // сохраняя пропорции букв и читаемость перевода.
            context.fillText(
              translatedLines[index],
              x,
              y + height / 2
            );
            textOverlay.push({
              text: translatedLines[index],
              x,
              y,
              width,
              height,
              fontSize
            });
          });

          const pageWidth = viewport.width / scale;
          const pageHeight = viewport.height / scale;
          const orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';
          const pageBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(
              blob => blob
                ? resolve(blob)
                : reject(new Error('Не удалось подготовить изображение страницы PDF.')),
              'image/jpeg',
              0.90
            );
          });
          const pageImageBytes = new Uint8Array(await pageBlob.arrayBuffer());

          if (!outputPdf) {
            outputPdf = new JsPDF({
              orientation,
              unit: 'pt',
              format: [pageWidth, pageHeight],
              compress: true
            });
          } else {
            outputPdf.addPage([pageWidth, pageHeight], orientation);
          }

          outputPdf.addImage(
            pageImageBytes,
            'JPEG',
            0,
            0,
            pageWidth,
            pageHeight,
            undefined,
            'FAST'
          );

          if (unicodeFontData) {
            registerPdfUnicodeFont(outputPdf, unicodeFontData);
          }
          const pointScaleX = pageWidth / canvas.width;
          const pointScaleY = pageHeight / canvas.height;
          // Preserve external URI links and resolvable internal page links.
          try {
            const annotations = await page.getAnnotations({ intent: 'display' });
            if (typeof outputPdf.link === 'function') {
              for (const annotation of annotations) {
                if (annotation?.subtype !== 'Link' || !Array.isArray(annotation.rect)) continue;
                const viewportRect = viewport.convertToViewportRectangle(annotation.rect);
                if (!Array.isArray(viewportRect) || viewportRect.length !== 4) continue;
                const left = Math.max(0, Math.min(pageWidth, Math.min(viewportRect[0], viewportRect[2]) * pointScaleX));
                const top = Math.max(0, Math.min(pageHeight, Math.min(viewportRect[1], viewportRect[3]) * pointScaleY));
                const right = Math.max(0, Math.min(pageWidth, Math.max(viewportRect[0], viewportRect[2]) * pointScaleX));
                const bottom = Math.max(0, Math.min(pageHeight, Math.max(viewportRect[1], viewportRect[3]) * pointScaleY));
                if (right - left < 1 || bottom - top < 1) continue;
                if (annotation.url) {
                  let safeUrl;
                  try { safeUrl = new URL(annotation.url); } catch (_) { continue; }
                  if (!['http:', 'https:', 'mailto:'].includes(safeUrl.protocol)) continue;
                  outputPdf.link(left, top, right - left, bottom - top, { url: safeUrl.href });
                  continue;
                }
                try {
                  let destination = annotation.dest;
                  if (typeof destination === 'string') destination = await sourcePdf.getDestination(destination);
                  if (!Array.isArray(destination) || !destination.length) continue;
                  const pageReference = destination[0];
                  const targetPageIndex = Number.isInteger(pageReference)
                    ? pageReference
                    : await sourcePdf.getPageIndex(pageReference);
                  if (!Number.isInteger(targetPageIndex) || targetPageIndex < 0 || targetPageIndex >= sourcePdf.numPages) continue;
                  outputPdf.link(left, top, right - left, bottom - top, { pageNumber: targetPageIndex + 1 });
                } catch (_) {
                  // Unresolvable internal destinations are skipped safely.
                }
              }
            }
          } catch (_) {
            // Missing or malformed annotations must not prevent page translation.
          }

          if (unicodeFontData) textOverlay.forEach(item => {
            if (!item.text || !item.text.trim()) return;

            const maxWidth = Math.max(1, item.width * pointScaleX);
            let overlayFontSize = Math.max(4, item.fontSize * pointScaleY);
            outputPdf.setFontSize(overlayFontSize);
            const measuredWidth = outputPdf.getTextWidth(item.text);
            if (measuredWidth > maxWidth) {
              overlayFontSize = Math.max(
                4,
                overlayFontSize * maxWidth / measuredWidth
              );
              outputPdf.setFontSize(overlayFontSize);
            }

            outputPdf.text(
              item.text,
              item.x * pointScaleX,
              (item.y + item.height / 2) * pointScaleY,
              {
                renderingMode: 'invisible',
                baseline: 'middle'
              }
            );
          });
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
          if (page) {
            try {
              await page.cleanup();
            } catch (_) {
              // Ошибка очистки одной страницы не должна скрывать основную ошибку обработки.
            }
          }
        }

        progress(
          5 + pageNumber / sourcePdf.numPages * 85,
          'Обработано страниц PDF: ' + pageNumber + ' из ' + sourcePdf.numPages
        );
      }

      if (!outputPdf) {
        throw new Error('PDF не содержит страниц для сборки.');
      }

      // Переносим дерево закладок PDF, сохраняя вложенность и переходы на страницы.
      // jsPDF 2.5.x включает Outline plugin; при отсутствии API исходный перевод не прерываем.
      try {
        const sourceOutline = typeof sourcePdf.getOutline === 'function'
          ? await sourcePdf.getOutline()
          : null;
        const outlineApi = outputPdf.outline;
        if (Array.isArray(sourceOutline) && sourceOutline.length &&
            outlineApi && typeof outlineApi.add === 'function') {
          let addedOutlineItems = 0;
          const MAX_OUTLINE_ITEMS = 2000;
          const MAX_OUTLINE_DEPTH = 32;

          const resolveOutlinePage = async destinationValue => {
            try {
              let destination = destinationValue;
              if (typeof destination === 'string') {
                destination = await sourcePdf.getDestination(destination);
              }
              if (!Array.isArray(destination) || !destination.length) return null;
              const pageReference = destination[0];
              const pageIndex = Number.isInteger(pageReference)
                ? pageReference
                : await sourcePdf.getPageIndex(pageReference);
              return Number.isInteger(pageIndex) &&
                pageIndex >= 0 && pageIndex < sourcePdf.numPages
                ? pageIndex + 1
                : null;
            } catch (_) {
              return null;
            }
          };

          const findFirstOutlinePage = async (items, depth) => {
            if (!Array.isArray(items) || depth > MAX_OUTLINE_DEPTH) return null;
            for (const child of items) {
              if (!child) continue;
              const directPage = await resolveOutlinePage(child.dest);
              if (directPage) return directPage;
              const nestedPage = await findFirstOutlinePage(child.items, depth + 1);
              if (nestedPage) return nestedPage;
            }
            return null;
          };

          const addOutlineItems = async (items, parent, depth) => {
            if (!Array.isArray(items) || depth > MAX_OUTLINE_DEPTH) return;
            for (const item of items) {
              if (addedOutlineItems >= MAX_OUTLINE_ITEMS) return;
              if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;
              // У некоторых PDF узел-раздел не имеет собственного адреса,
              // но содержит дочерние пункты. Привязываем его к первой странице потомков.
              const pageNumber = await resolveOutlinePage(item.dest) ||
                await findFirstOutlinePage(item.items, depth + 1);
              if (!pageNumber) continue;

              const originalTitle = item.title.replace(/[\\u0000-\\u001F\\u007F]/g, ' ').trim().slice(0, 500);
              let translatedTitle = originalTitle;
              try {
                const candidate = await translateInParts(originalTitle);
                if (typeof candidate === 'string' && candidate.trim()) {
                  translatedTitle = candidate.trim().slice(0, 500);
                }
              } catch (_) {
                // Если перевод названия закладки не удался, оставляем исходное название.
              }

              const outlineOptions = { pageNumber };
              if (item.bold === true) outlineOptions.bold = true;
              if (item.italic === true) outlineOptions.italic = true;
              const node = outlineApi.add(parent || null, translatedTitle, outlineOptions);
              addedOutlineItems += 1;
              if (Array.isArray(item.items) && item.items.length) {
                await addOutlineItems(item.items, node, depth + 1);
              }
            }
          };

          await addOutlineItems(sourceOutline, null, 0);
        }
      } catch (_) {
        // Недоступные или повреждённые закладки не должны блокировать создание PDF.
      }

      // Переносим доступные описательные метаданные исходного PDF.
      // Технические поля сборщика (producer/версия) оставляем новому PDF.
      try {
        const metadata = await sourcePdf.getMetadata();
        const info = metadata?.info || {};
        const cleanMetadata = value => typeof value === 'string'
          ? value.replace(/[\\u0000-\\u001F\\u007F]/g, ' ').trim().slice(0, 4000)
          : '';
        const properties = {
          title: cleanMetadata(info.Title),
          subject: cleanMetadata(info.Subject),
          author: cleanMetadata(info.Author),
          keywords: cleanMetadata(info.Keywords),
          creator: cleanMetadata(info.Creator)
        };
        if (Object.values(properties).some(Boolean) && typeof outputPdf.setProperties === 'function') {
          outputPdf.setProperties(properties);
        }
      } catch (_) {
        // Недоступные или повреждённые метаданные не должны блокировать перевод страниц.
      }

      const blob = outputPdf.output('blob');
      return {
        blob,
        text: previewParts.join('\n\n') || 'Текст на страницах PDF не распознан.'
      };
    } finally {
      outputPdf = null;
      previewParts.length = 0;
      try {
        await sourcePdf.destroy();
      } catch (_) {
        // Освобождение PDF.js ресурсов не должно заменять исходную ошибку.
      }
    }
  }

  async function translateDocxPackage(file, nestingLevel = 0) {
    const MAX_DOCX_INPUT_BYTES = 100 * 1024 * 1024;
    const MAX_PACKAGE_ENTRIES = 12000;
    const MAX_PACKAGE_UNCOMPRESSED_BYTES = 350 * 1024 * 1024;
    const MAX_SINGLE_PART_BYTES = 100 * 1024 * 1024;
    const MAX_COMPRESSION_RATIO = 250;

    if (!file || !Number.isFinite(file.size) || file.size <= 0) {
      throw new Error('Не удалось определить размер DOCX-файла.');
    }
    if (file.size > MAX_DOCX_INPUT_BYTES) {
      throw new Error('DOCX больше 100 МБ. Разделите документ на несколько частей для безопасной обработки.');
    }

    const JSZip = await ensureJSZip();

    function validatePackageLimits(packageZip, label) {
      const names = Object.keys(packageZip.files);
      if (names.length > MAX_PACKAGE_ENTRIES) {
        throw new Error(label + ': слишком много элементов внутри архива DOCX.');
      }

      let totalUncompressed = 0;
      for (const name of names) {
        const entry = packageZip.files[name];
        if (!entry || entry.dir) continue;
        const data = entry._data;
        const uncompressed = Number(data?.uncompressedSize);
        const compressed = Number(data?.compressedSize);
        if (!Number.isFinite(uncompressed) || uncompressed < 0) {
          throw new Error(label + ': невозможно проверить размер элемента ' + name);
        }
        if (uncompressed > MAX_SINGLE_PART_BYTES) {
          throw new Error(label + ': слишком большой элемент архива — ' + name);
        }
        totalUncompressed += uncompressed;
        if (totalUncompressed > MAX_PACKAGE_UNCOMPRESSED_BYTES) {
          throw new Error(label + ': распакованный размер превышает безопасный предел 350 МБ.');
        }
        if (
          uncompressed > 1024 * 1024 &&
          Number.isFinite(compressed) &&
          compressed > 0 &&
          uncompressed / compressed > MAX_COMPRESSION_RATIO
        ) {
          throw new Error(label + ': обнаружена подозрительная степень сжатия в элементе ' + name);
        }
      }
    }

    async function verifyNestedPackage(originalZip, rebuiltBytes, label) {
      const rebuiltZip = await JSZip.loadAsync(rebuiltBytes);
      validatePackageLimits(rebuiltZip, label + ' после сборки');
      const originalNames = Object.keys(originalZip.files).filter(name => !originalZip.files[name].dir);
      const rebuiltNames = Object.keys(rebuiltZip.files).filter(name => !rebuiltZip.files[name].dir);
      if (
        originalNames.length !== rebuiltNames.length ||
        originalNames.some(name => !rebuiltZip.file(name)) ||
        rebuiltNames.some(name => !originalZip.file(name))
      ) {
        throw new Error(label + ': после сборки изменился состав ZIP-пакета.');
      }
      for (const relationship of originalZip.file(/\\.rels$/i)) {
        const rebuiltRelationship = rebuiltZip.file(relationship.name);
        if (!rebuiltRelationship) throw new Error(label + ': потеряна связь ' + relationship.name);
        const before = await relationship.async('uint8array');
        const after = await rebuiltRelationship.async('uint8array');
        if (before.length !== after.length || before.some((byte, i) => byte !== after[i])) {
          throw new Error(label + ': изменена связь ' + relationship.name);
        }
      }
      return rebuiltZip;
    }

    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    validatePackageLimits(zip, 'DOCX');
    // Фиксируем состав пакета и байты relationship-файлов: перевод не должен
    // удалять ресурсы или менять связи между документом, рисунками и диаграммами.
    const originalPartNames = Object.keys(zip.files).filter(name => !zip.files[name].dir);
    const originalRelationships = new Map();
    for (const relationship of zip.file(/\.rels$/i)) {
      originalRelationships.set(
        relationship.name,
        await relationship.async('uint8array')
      );
    }
    // Критические ресурсы оформления фиксируем отдельно: перевод текста не
    // должен менять стили, темы, нумерацию, настройки или встроенные шрифты.
    const protectedWordParts = zip.file(
      /^word\/(styles\.xml|numbering\.xml|fontTable\.xml|settings\.xml|webSettings\.xml|theme\/.*|fonts\/.*)$/i
    ).filter(entry => !entry.dir);
    const originalProtectedParts = new Map();
    for (const entry of protectedWordParts) {
      originalProtectedParts.set(entry.name, await entry.async('uint8array'));
    }
    const entries = zip.file(/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/i).concat(zip.file(/^word\/glossary\/document\.xml$/i));

    if (!entries.length) {
      throw new Error('В DOCX не найдена основная структура Word.');
    }

    const previewParts = [];
    const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const chartNs = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
    const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

    function docxStructureSignature(doc) {
      const parts = [];
      const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT);
      let element;
      while ((element = walker.nextNode())) {
        const attributes = Array.from(element.attributes)
          .filter(attribute => {
            const localName = attribute.localName || attribute.name;
            // Эти атрибуты меняются только для перевода альтернативного текста
            // или корректного сохранения пробелов в текстовых узлах.
            if (localName === 'title' || localName === 'descr' || localName === 'alt') return false;
            if (
              localName === 'space' &&
              attribute.namespaceURI === 'http://www.w3.org/XML/1998/namespace'
            ) return false;
            return true;
          })
          .map(attribute => [
            attribute.namespaceURI || '',
            attribute.localName || attribute.name,
            attribute.value
          ])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        parts.push([
          element.namespaceURI || '',
          element.localName || element.nodeName,
          attributes
        ]);
      }
      return JSON.stringify(parts);
    }

    async function translateTextGroups(groups, namespace, tagName) {
      for (const group of groups) {
        let nodes = Array.from(group.getElementsByTagNameNS(namespace, tagName));
        nodes = nodes.filter(node => {
          let parent = node.parentElement;
          while (parent && parent !== group) {
            // Не захватываем содержимое вложенного абзаца (например,
            // текстового блока внутри рисунка): он будет обработан отдельно.
            if (
              parent.namespaceURI === group.namespaceURI &&
              parent.localName === group.localName
            ) return false;
            // Удалённые фрагменты Track Changes не являются текущим текстом.
            if (
              namespace === wordNs &&
              tagName === 't' &&
              parent.namespaceURI === wordNs &&
              parent.localName === 'del'
            ) return false;
            parent = parent.parentElement;
          }
          return parent === group;
        });
        if (!nodes.length) continue;
        const source = nodes.map(node => node.textContent || '').join('');
        if (!source.trim()) continue;
        const leading = source.match(/^\s*/)?.[0] || '';
        const trailing = source.match(/\s*$/)?.[0] || '';
        const translated = await translateInParts(source.trim());
        previewParts.push(translated);
        distributeTranslatedText(leading + translated + trailing, nodes);
      }
    }

    async function translateDescriptionAttributes(doc, namespaces) {
      for (const namespace of namespaces) {
        const elements = Array.from(doc.getElementsByTagNameNS(namespace, '*'));
        for (const element of elements) {
          // У VML и Office альтернативный текст иногда хранится
          // в атрибутах с отдельным namespace (например, o:title).
          const attributes = Array.from(element.attributes).filter(attribute =>
            ['title', 'descr', 'alt'].includes(attribute.localName || attribute.name)
          );
          for (const attribute of attributes) {
            if (!attribute.value.trim()) continue;
            const original = attribute.value;
            const leading = original.match(/^\\s*/)?.[0] || '';
            const trailing = original.match(/\\s*$/)?.[0] || '';
            const translated = await translateInParts(original.trim());
            previewParts.push(translated);
            attribute.value = leading + translated + trailing;
          }
        }
      }
    }

    for (const entry of entries) {
      const doc = new DOMParser().parseFromString(await entry.async('text'), 'application/xml');
      if (doc.querySelector('parsererror')) {
        throw new Error('Не удалось прочитать часть DOCX: ' + entry.name);
      }
      const originalStructure = docxStructureSignature(doc);

      // Абзацы включают текст в ячейках таблиц, колонтитулах,
      // сносках, примечаниях и комментариях; разметка Word сохраняется.
      const paragraphs = Array.from(doc.getElementsByTagNameNS(wordNs, 'p'));
      await translateTextGroups(paragraphs, wordNs, 't');

      // Встроенные текстовые блоки фигур и рисунков используют DrawingML,
      // а не WordprocessingML. Они находятся прямо в document/header XML.
      const drawingParagraphs = Array.from(doc.getElementsByTagNameNS(drawingNs, 'p'));
      await translateTextGroups(drawingParagraphs, drawingNs, 't');

      // Переводим альтернативные описания объектов, не меняя их идентификаторы.
      await translateDescriptionAttributes(doc, [
        'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
        'http://schemas.openxmlformats.org/drawingml/2006/picture',
        'urn:schemas-microsoft-com:vml',
        'urn:schemas-microsoft-com:office:office',
        drawingNs
      ]);
      if (docxStructureSignature(doc) !== originalStructure) {
        throw new Error('При переводе изменилась структура или оформление Word: ' + entry.name);
      }
      zip.file(entry.name, new XMLSerializer().serializeToString(doc));
    }

    // Отдельные части DrawingML: подписи диаграмм, SmartArt и текст фигур.
    const drawingEntries = zip.file(/^word\/(charts|diagrams|drawings)\/.*\.xml$/i);
    for (const entry of drawingEntries) {
      const doc = new DOMParser().parseFromString(await entry.async('text'), 'application/xml');
      if (doc.querySelector('parsererror')) {
        throw new Error('Не удалось прочитать диаграмму или схему: ' + entry.name);
      }
      const paragraphs = Array.from(doc.getElementsByTagNameNS(drawingNs, 'p'));
      await translateTextGroups(paragraphs, drawingNs, 't');
      await translateDescriptionAttributes(doc, [drawingNs]);

      // Подписи категорий могут храниться в текстовом кэше диаграммы.
      // Числовые кэши не затрагиваем.
      if (entry.name.startsWith('word/charts/')) {
        const stringCaches = [
          ...Array.from(doc.getElementsByTagNameNS(chartNs, 'strCache')),
          ...Array.from(doc.getElementsByTagNameNS(chartNs, 'strLit')),
          // Многоуровневые подписи осей хранятся в отдельном кэше.
          ...Array.from(doc.getElementsByTagNameNS(chartNs, 'multiLvlStrCache'))
        ];
        await translateTextGroups(stringCaches, chartNs, 'v');
      }
      zip.file(entry.name, new XMLSerializer().serializeToString(doc));
    }

    // Встроенные книги Excel: переводим текстовые значения и подписи,
    // не изменяя формулы и числовые данные.
    const embeddedBooks = zip.file(/^word\/embeddings\/.*\.xlsx$/i);
    for (const embedded of embeddedBooks) {
      const nestedZip = await JSZip.loadAsync(await embedded.async('uint8array'));
      validatePackageLimits(nestedZip, 'Встроенная книга Excel');
      const textFiles = nestedZip.file(/^xl\/(sharedStrings|worksheets\/sheet\d+|charts\/chart\d+)\.xml$/i);
      for (const nestedEntry of textFiles) {
        const doc = new DOMParser().parseFromString(await nestedEntry.async('text'), 'application/xml');
        if (doc.querySelector('parsererror')) {
          throw new Error('Не удалось прочитать встроенную таблицу Excel: ' + nestedEntry.name);
        }
        if (nestedEntry.name.includes('sharedStrings')) {
          const groups = Array.from(doc.getElementsByTagNameNS(sheetNs, 'si'));
          await translateTextGroups(groups, sheetNs, 't');
        } else if (nestedEntry.name.includes('/charts/')) {
          const paragraphs = Array.from(doc.getElementsByTagNameNS(drawingNs, 'p'));
          await translateTextGroups(paragraphs, drawingNs, 't');
          const caches = [
            ...Array.from(doc.getElementsByTagNameNS(chartNs, 'strCache')),
            ...Array.from(doc.getElementsByTagNameNS(chartNs, 'strLit')),
            ...Array.from(doc.getElementsByTagNameNS(chartNs, 'multiLvlStrCache'))
          ];
          await translateTextGroups(caches, chartNs, 'v');
        } else {
          const groups = Array.from(doc.getElementsByTagNameNS(sheetNs, 'is'));
          await translateTextGroups(groups, sheetNs, 't');
        }
        nestedZip.file(nestedEntry.name, new XMLSerializer().serializeToString(doc));
      }
      const rebuiltNestedBytes = await nestedZip.generateAsync({ type: 'uint8array' });
      await verifyNestedPackage(nestedZip, rebuiltNestedBytes, 'Вложенный пакет Office');
      zip.file(embedded.name, rebuiltNestedBytes);
    }

    // Встроенные презентации PowerPoint: переводим текст слайдов,
    // заметок, макетов, образцов и текстовые подписи диаграмм.
    const embeddedPresentations = zip.file(/^word\/embeddings\/.*\.pptx$/i);
    const presentationNs = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    for (const embedded of embeddedPresentations) {
      const nestedZip = await JSZip.loadAsync(await embedded.async('uint8array'));
      validatePackageLimits(nestedZip, 'Встроенная презентация PowerPoint');
      const presentationParts = nestedZip.file(/^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+|slideLayouts\/slideLayout\d+|slideMasters\/slideMaster\d+|charts\/chart\d+|diagrams\/.*)\.xml$/i);
      for (const nestedEntry of presentationParts) {
        const doc = new DOMParser().parseFromString(await nestedEntry.async('text'), 'application/xml');
        if (doc.querySelector('parsererror')) {
          throw new Error('Не удалось прочитать встроенную презентацию: ' + nestedEntry.name);
        }
        await translateTextGroups(
          Array.from(doc.getElementsByTagNameNS(drawingNs, 'p')),
          drawingNs,
          't'
        );
        await translateDescriptionAttributes(doc, [presentationNs, drawingNs]);
        if (nestedEntry.name.startsWith('ppt/charts/')) {
          const caches = [
            ...Array.from(doc.getElementsByTagNameNS(chartNs, 'strCache')),
            ...Array.from(doc.getElementsByTagNameNS(chartNs, 'strLit'))
          ];
          await translateTextGroups(caches, chartNs, 'v');
        }
        nestedZip.file(nestedEntry.name, new XMLSerializer().serializeToString(doc));
      }
      zip.file(embedded.name, await nestedZip.generateAsync({ type: 'uint8array' }));
    }

    // Вложенные документы Word обрабатываем рекурсивно, ограничивая глубину.
    const embeddedWordFiles = zip.file(/^word\/embeddings\/.*\.docx$/i);
    for (const embedded of embeddedWordFiles) {
      if (nestingLevel >= 3) {
        previewParts.push('Вложенный DOCX пропущен: достигнуто ограничение глубины вложения.');
        continue;
      }
      const nestedBlob = new Blob(
        [await embedded.async('uint8array')],
        { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
      );
      const nestedResult = await translateDocxPackage(nestedBlob, nestingLevel + 1);
      zip.file(embedded.name, await nestedResult.blob.arrayBuffer());
      if (nestedResult.text && !nestedResult.text.startsWith('В DOCX не найден')) {
        previewParts.push(nestedResult.text);
      }
    }

    // Переводим пользовательские описательные свойства Word,
    // не меняя автора, редактора, даты, идентификаторы и служебные свойства.
    const corePropertiesEntry = zip.file('docProps/core.xml');
    if (corePropertiesEntry) {
      const coreDoc = new DOMParser().parseFromString(
        await corePropertiesEntry.async('text'),
        'application/xml'
      );
      if (coreDoc.querySelector('parsererror')) {
        throw new Error('Не удалось прочитать свойства документа Word.');
      }
      const coreNamespace = 'http://purl.org/dc/elements/1.1/';
      const packageCoreNamespace = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
      const translatableCoreProperties = [
        [coreNamespace, 'title'],
        [coreNamespace, 'subject'],
        [coreNamespace, 'description'],
        [packageCoreNamespace, 'keywords']
      ];
      for (const [namespace, localName] of translatableCoreProperties) {
        for (const element of Array.from(coreDoc.getElementsByTagNameNS(namespace, localName))) {
          const original = element.textContent || '';
          if (!original.trim()) continue;
          const leading = original.match(/^\\s*/)?.[0] || '';
          const trailing = original.match(/\\s*$/)?.[0] || '';
          const translated = await translateInParts(original.trim());
          previewParts.push(translated);
          element.textContent = leading + translated + trailing;
        }
      }
      zip.file('docProps/core.xml', new XMLSerializer().serializeToString(coreDoc));
    }

    // Старые OLE-вложения сохраняем в пакете без изменения байтов.
    // Их внутреннее содержимое требует отдельного специализированного парсера.
    const legacyOleParts = zip.file(/word\/embeddings\//i)
      .filter(entry => /\.(bin|xls|ppt|doc)$/i.test(entry.name));
    if (legacyOleParts.length) {
      previewParts.push(
        'Примечание: старые встроенные OLE-объекты сохранены без изменений; их внутренний текст не переводился.'
      );
    }
    // Поля Word (instrText), формулы OMML, коды нумерации и связи объектов
    // намеренно не переписываются: переводятся только обычные текстовые узлы w:t.

    // Перед упаковкой проверяем, что ни одна исходная часть не исчезла,
    // а связи OOXML остались побайтно прежними.
    for (const partName of originalPartNames) {
      if (!zip.file(partName)) {
        throw new Error('При сборке DOCX потеряна часть исходного пакета: ' + partName);
      }
    }
    for (const [relationshipName, originalBytes] of originalRelationships) {
      const currentEntry = zip.file(relationshipName);
      if (!currentEntry) {
        throw new Error('Потеряны связи DOCX: ' + relationshipName);
      }
      const currentBytes = await currentEntry.async('uint8array');
      if (
        currentBytes.length !== originalBytes.length ||
        currentBytes.some((byte, index) => byte !== originalBytes[index])
      ) {
        throw new Error('Изменились связи объектов DOCX: ' + relationshipName);
      }
    }

    for (const [partName, originalBytes] of originalProtectedParts) {
      const currentEntry = zip.file(partName);
      if (!currentEntry) {
        throw new Error('Потерян ресурс оформления Word: ' + partName);
      }
      const currentBytes = await currentEntry.async('uint8array');
      if (
        currentBytes.length !== originalBytes.length ||
        currentBytes.some((byte, index) => byte !== originalBytes[index])
      ) {
        throw new Error('Изменился защищённый ресурс оформления Word: ' + partName);
      }
    }

    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    // Повторно открываем уже собранный архив: проверка до упаковки не
    // гарантирует, что ZIP корректно сериализовался и читается после сборки.
    const verifiedZip = await JSZip.loadAsync(await blob.arrayBuffer());
    validatePackageLimits(verifiedZip, 'Собранный DOCX');
    const verifiedPartNames = Object.keys(verifiedZip.files).filter(name => !verifiedZip.files[name].dir);
    if (
      verifiedPartNames.length !== originalPartNames.length ||
      originalPartNames.some(name => !verifiedZip.file(name)) ||
      verifiedPartNames.some(name => !originalPartNames.includes(name))
    ) {
      throw new Error('Проверка собранного DOCX выявила изменение состава ZIP-пакета.');
    }

    for (const relationshipName of originalRelationships.keys()) {
      const relationshipEntry = verifiedZip.file(relationshipName);
      if (!relationshipEntry) {
        throw new Error('В собранном DOCX отсутствуют связи: ' + relationshipName);
      }
      const relationshipBytes = await relationshipEntry.async('uint8array');
      const originalBytes = originalRelationships.get(relationshipName);
      if (
        relationshipBytes.length !== originalBytes.length ||
        relationshipBytes.some((byte, index) => byte !== originalBytes[index])
      ) {
        throw new Error('Проверка собранного DOCX выявила изменение связей: ' + relationshipName);
      }
    }

    for (const partName of originalProtectedParts.map(entry => entry.name)) {
      const verifiedEntry = verifiedZip.file(partName);
      if (!verifiedEntry) {
        throw new Error('В собранном DOCX отсутствует защищённый ресурс: ' + partName);
      }
      const verifiedBytes = await verifiedEntry.async('uint8array');
      const originalBytes = originalProtectedParts.get(partName);
      if (
        verifiedBytes.length !== originalBytes.length ||
        verifiedBytes.some((byte, index) => byte !== originalBytes[index])
      ) {
        throw new Error('Проверка собранного DOCX выявила изменение оформления: ' + partName);
      }
    }

    return {
      blob,
      text: previewParts.join('\n\n') || 'В DOCX не найден текст для перевода.'
    };
  }

  async function translateEpubPackage(file) {
    if (file.size > 100 * 1024 * 1024) {
      throw new Error('Для перевода EPUB в браузере пока поддерживаются файлы до 100 МБ.');
    }

    const JSZip = await ensureJSZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const mimetypeEntry = zip.file('mimetype');
    if (!mimetypeEntry || (await mimetypeEntry.async('text')).trim() !== 'application/epub+zip') {
      throw new Error('Файл не соответствует структуре EPUB: отсутствует корректный mimetype.');
    }

    const chapterEntries = zip.file(/\.(xhtml|html|htm)$/i).filter(entry => !entry.dir);
    const ncxEntries = zip.file(/\.ncx$/i).filter(entry => !entry.dir);
    if (!chapterEntries.length) {
      throw new Error('В EPUB не найдены главы XHTML/HTML.');
    }

    const previewParts = [];
    const chapterSelector = 'title,p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,figcaption,caption,dt,dd';

    for (const entry of [...chapterEntries, ...ncxEntries]) {
      const isNcx = /\.ncx$/i.test(entry.name);
      const xml = await entry.async('text');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) {
        throw new Error('Не удалось прочитать раздел EPUB: ' + entry.name);
      }

      // NCX содержит отдельные подписи оглавления в элементах <text>.
      // Переводим только их содержимое: navPoint, playOrder и content src остаются прежними.
      const updated = await translateXmlBlocks(
        new XMLSerializer().serializeToString(doc),
        isNcx ? 'text' : chapterSelector,
        isNcx ? 'оглавление EPUB' : 'главы EPUB',
        previewParts
      );
      const translatedDoc = new DOMParser().parseFromString(updated, 'application/xml');
      if (translatedDoc.querySelector('parsererror')) {
        throw new Error('После перевода повреждена XML-разметка EPUB: ' + entry.name);
      }

      if (!isNcx) {
        // Переводим доступные описания изображений и подсказки, не меняя src/href,
        // идентификаторы, классы CSS и ссылки навигации.
        const translatableAttributes = ['alt', 'title', 'aria-label'];
        for (const element of Array.from(translatedDoc.getElementsByTagName('*'))) {
          for (const attributeName of translatableAttributes) {
            const attribute = element.getAttributeNode(attributeName);
            if (!attribute || !attribute.value.trim()) continue;
            const original = attribute.value;
            const leading = original.match(/^\\s*/)?.[0] || '';
            const trailing = original.match(/\\s*$/)?.[0] || '';
            const translated = await translateInParts(original.trim());
            previewParts.push(translated);
            attribute.value = leading + translated + trailing;
          }
        }

        // EPUB 3 stores its table of contents in nav.xhtml. Translate only
        // links inside nav[epub:type~="toc"], leaving href and navigation IDs intact.
        for (const nav of Array.from(translatedDoc.getElementsByTagName('*')).filter(element =>
          (element.localName || '').toLowerCase() === 'nav' &&
          Array.from(element.attributes).some(attribute =>
            (attribute.localName || attribute.name.split(':').pop()) === 'type' &&
            String(attribute.value).split(/\s+/).includes('toc')
          )
        )) {
          const tocLinks = Array.from(nav.getElementsByTagName('*')).filter(element =>
            (element.localName || '').toLowerCase() === 'a'
          );
          for (const link of tocLinks) {
            const walker = translatedDoc.createTreeWalker(link, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            let textNode;
            while ((textNode = walker.nextNode())) {
              if (textNode.textContent && textNode.textContent.trim()) textNodes.push(textNode);
            }
            if (!textNodes.length) continue;
            const source = textNodes.map(node => node.textContent).join('');
            const leading = source.match(/^\s*/)?.[0] || '';
            const trailing = source.match(/\s*$/)?.[0] || '';
            const translated = await translateInParts(source.trim());
            previewParts.push(translated);
            distributeTranslatedText(leading + translated + trailing, textNodes);
          }
        }
      }

      zip.file(entry.name, new XMLSerializer().serializeToString(translatedDoc));
    }

    // Translate reader-facing EPUB package metadata without changing creator
    // names, identifiers, manifest paths, spine order, or resource references.
    const dcNamespace = 'http://purl.org/dc/elements/1.1/';
    const metadataEntries = zip.file(/\.opf$/i).filter(entry => !entry.dir);
    for (const entry of metadataEntries) {
      const metadataDoc = new DOMParser().parseFromString(await entry.async('text'), 'application/xml');
      if (metadataDoc.querySelector('parsererror')) {
        throw new Error('Не удалось прочитать метаданные EPUB: ' + entry.name);
      }
      const metadataTags = ['title', 'description', 'subject'];
      for (const tagName of metadataTags) {
        for (const element of Array.from(metadataDoc.getElementsByTagNameNS(dcNamespace, tagName))) {
          const walker = metadataDoc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const textNodes = [];
          let textNode;
          while ((textNode = walker.nextNode())) {
            if (textNode.textContent && textNode.textContent.trim()) textNodes.push(textNode);
          }
          if (!textNodes.length) continue;
          const source = textNodes.map(node => node.textContent).join('');
          const leading = source.match(/^\s*/)?.[0] || '';
          const trailing = source.match(/\s*$/)?.[0] || '';
          const translated = await translateInParts(source.trim());
          previewParts.push(translated);
          distributeTranslatedText(leading + translated + trailing, textNodes);
        }
      }
      zip.file(entry.name, new XMLSerializer().serializeToString(metadataDoc));
    }

    // EPUB requires the mimetype entry to be stored (not compressed).
    // Re-add it with STORE so the package generator doesn't deflate it.
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    return {
      blob,
      text: previewParts.join('\\n\\n') || 'В EPUB не найден текст для перевода.'
    };
  }



  function fb2StructureSignature(doc) {
    return Array.from(doc.getElementsByTagName('*')).map(element => {
      const attributes = Array.from(element.attributes || [])
        .filter(attribute =>
          !(attribute.namespaceURI === 'http://www.w3.org/XML/1998/namespace' &&
            attribute.localName === 'space')
        )
        .map(attribute => [
          attribute.namespaceURI || '',
          attribute.name,
          attribute.value
        ].join('='))
        .sort()
        .join('|');
      return [
        element.namespaceURI || '',
        element.localName || element.nodeName,
        attributes
      ].join('::');
    }).join('\n');
  }

  async function translateFb2Package(file) {
    if (file.size > 100 * 1024 * 1024) {
      throw new Error('FB2 больше 100 МБ не поддерживается в одном проходе браузера.');
    }

    const xml = await readText(file);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('Файл FB2 повреждён или содержит некорректный XML.');
    }

    const root = doc.documentElement;
    if (!root || root.localName !== 'FictionBook') {
      throw new Error('XML не распознан как книга FB2: отсутствует корень FictionBook.');
    }

    const structureBefore = fb2StructureSignature(doc);
    const binariesBefore = Array.from(doc.getElementsByTagName('*'))
      .filter(element => element.localName === 'binary')
      .map(element => ({
        attributes: Array.from(element.attributes || [])
          .map(attribute => [attribute.name, attribute.value]),
        content: element.textContent
      }));

    const translatableNames = new Set([
      'p', 'subtitle', 'title', 'v', 'annotation', 'epigraph', 'cite'
    ]);
    const allElements = Array.from(doc.getElementsByTagName('*'));
    const blocks = allElements.filter(element => {
      if (!translatableNames.has(element.localName)) return false;
      if (element.closest('binary')) return false;
      return !Array.from(element.getElementsByTagName('*'))
        .some(child => translatableNames.has(child.localName));
    });

    const previewParts = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const walker = doc.createTreeWalker(blocks[index], NodeFilter.SHOW_TEXT);
      const textNodes = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent && node.textContent.trim()) textNodes.push(node);
      }

      const source = textNodes.map(item => item.textContent).join('');
      if (!source.trim()) continue;

      const leading = source.match(/^\s*/)?.[0] || '';
      const trailing = source.match(/\s*$/)?.[0] || '';
      const translated = await translateInParts(source.trim());
      previewParts.push(translated);
      distributeTranslatedText(leading + translated + trailing, textNodes);

      progress(
        45 + (index + 1) / Math.max(1, blocks.length) * 45,
        'Переводим FB2: блок ' + (index + 1) + ' из ' + blocks.length + '…'
      );
    }

    const binariesAfter = Array.from(doc.getElementsByTagName('*'))
      .filter(element => element.localName === 'binary')
      .map(element => ({
        attributes: Array.from(element.attributes || [])
          .map(attribute => [attribute.name, attribute.value]),
        content: element.textContent
      }));

    if (fb2StructureSignature(doc) !== structureBefore) {
      throw new Error('Проверка FB2 выявила изменение структуры или ссылок. Исходный файл не будет выдан как готовый.');
    }
    if (JSON.stringify(binariesAfter) !== JSON.stringify(binariesBefore)) {
      throw new Error('Проверка FB2 выявила изменение встроенных изображений. Исходный файл не будет выдан как готовый.');
    }

    const updated = new XMLSerializer().serializeToString(doc);
    const verified = new DOMParser().parseFromString(updated, 'application/xml');
    if (verified.querySelector('parsererror') ||
        !verified.documentElement ||
        verified.documentElement.localName !== 'FictionBook') {
      throw new Error('Не удалось подтвердить целостность собранного FB2-файла.');
    }

    return {
      blob: new Blob([updated], { type: 'application/x-fictionbook+xml;charset=utf-8' }),
      text: previewParts.join('\n\n') || 'В FB2 не найден текст для перевода.'
    };
  }

  function readableTextColor(backgroundColor) {
    const values = String(backgroundColor || '').match(/[\d.]+/g);
    if (!values || values.length < 3) return '#202020';

    const channels = values.slice(0, 3).map(value => {
      const channel = Math.max(0, Math.min(255, Number(value))) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    const luminance =
      0.2126 * channels[0] +
      0.7152 * channels[1] +
      0.0722 * channels[2];

    return luminance > 0.42 ? '#202020' : '#ffffff';
  }

  function sampleBackgroundColor(context, box, width, height) {
    if (!context || !box || width < 1 || height < 1) {
      return 'rgba(255,255,255,0.95)';
    }

    const left = Math.max(0, Math.min(width - 1, Math.floor(box.x0)));
    const right = Math.max(0, Math.min(width - 1, Math.ceil(box.x1)));
    const top = Math.max(0, Math.min(height - 1, Math.floor(box.y0)));
    const bottom = Math.max(0, Math.min(height - 1, Math.ceil(box.y1)));
    if (right < left || bottom < top) return 'rgba(255,255,255,0.95)';

    const samples = [];
    const horizontalStep = Math.max(2, Math.floor(Math.max(1, right - left) / 12));
    const verticalStep = Math.max(2, Math.floor(Math.max(1, bottom - top) / 8));
    const readPixel = (x, y) => {
      const safeX = Math.max(0, Math.min(width - 1, x));
      const safeY = Math.max(0, Math.min(height - 1, y));
      try {
        const pixel = context.getImageData(safeX, safeY, 1, 1).data;
        samples.push([pixel[0], pixel[1], pixel[2], pixel[3]]);
      } catch (_) {
        // Если браузер не может прочитать отдельный пиксель, пропускаем его.
      }
    };

    // Медиана точек по четырём сторонам рамки.
    for (let x = left; x <= right; x += horizontalStep) {
      readPixel(x, top - 3);
      readPixel(x, bottom + 3);
    }
    for (let y = top; y <= bottom; y += verticalStep) {
      readPixel(left - 3, y);
      readPixel(right + 3, y);
    }

    if (!samples.length) return 'rgba(255,255,255,0.95)';

    const median = [0, 1, 2, 3].map(channel => {
      const values = samples.map(pixel => pixel[channel]).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return Math.round(values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2);
    });

    // Сохраняем прозрачность фона: непрозрачные области остаются
    // непрозрачными, а прозрачные не превращаются в белые прямоугольники.
    return 'rgba(' + median[0] + ',' + median[1] + ',' + median[2] + ',' +
      (median[3] / 255) + ')';
  }

  async function translateImageFile(file) {
    const currentOcrLanguage = $('srcLang')?.value || 'auto';
    // OCR-координаты относятся к конкретному файлу: нельзя переиспользовать
    // распознанные строки предыдущей картинки только потому, что язык тот же.
    if (lastOcrFile !== file || lastOcrLanguage !== currentOcrLanguage || !lastOcrLines.length) {
      lastOcrLines = [];
      lastOcrFile = null;
      await ocrImage(file);
      lastOcrFile = file;
    }

    const lines = lastOcrLines.filter(line =>
      line.text && line.text.trim() && line.bbox &&
      Number.isFinite(line.bbox.x0) && Number.isFinite(line.bbox.y0) &&
      Number.isFinite(line.bbox.x1) && Number.isFinite(line.bbox.y1) &&
      line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0
    );
    if (!lines.length) {
      throw new Error('Не удалось получить координаты текста на изображении. Попробуйте более чёткий JPG или PNG.');
    }

    const translatedLines = [];
    for (let index = 0; index < lines.length; index += 1) {
      translatedLines.push(await translateInParts(lines[index].text.trim()));
      progress(
        45 + (index + 1) / lines.length * 40,
        'Переводим строки изображения: ' + (index + 1) + ' из ' + lines.length + '…'
      );
    }

    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    let canvas = null;

    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Не удалось открыть исходное изображение.'));
        image.src = objectUrl;
      });

      if (!image.naturalWidth || !image.naturalHeight) {
        throw new Error('Исходное изображение имеет некорректные размеры.');
      }
      if (image.naturalWidth * image.naturalHeight > 32000000) {
        throw new Error('Изображение слишком большое для безопасной обработки в браузере. Уменьшите его размер и повторите попытку.');
      }

      canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Не удалось подготовить изображение для перевода.');
      context.drawImage(image, 0, 0);

      lines.forEach((line, index) => {
        const box = line.bbox;
        const x = Math.max(0, Math.min(canvas.width - 1, box.x0));
        const y = Math.max(0, Math.min(canvas.height - 1, box.y0));
        const width = Math.max(1, Math.min(canvas.width - x, box.x1 - box.x0));
        const height = Math.max(1, Math.min(canvas.height - y, box.y1 - box.y0));

        const patchX = Math.max(0, x - 2);
        const patchY = Math.max(0, y - 1);
        const patchWidth = Math.min(canvas.width - patchX, width + 4);
        const patchHeight = Math.min(canvas.height - patchY, height + 2);
        const backgroundColor = sampleBackgroundColor(context, box, canvas.width, canvas.height);
        // Сначала очищаем область, затем восстанавливаем её медианным цветом
        // и исходной альфой — иначе прозрачный PNG станет непрозрачным.
        context.clearRect(patchX, patchY, patchWidth, patchHeight);
        context.fillStyle = backgroundColor;
        context.fillRect(patchX, patchY, patchWidth, patchHeight);

        let fontSize = Math.max(8, Math.min(36, height * 0.76));
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.font = '600 ' + fontSize + 'px Arial, sans-serif';

        while (
          fontSize > 7 &&
          context.measureText(translatedLines[index]).width > width + 2
        ) {
          fontSize -= 1;
          context.font = '600 ' + fontSize + 'px Arial, sans-serif';
        }

        context.fillStyle = '#202020';
        context.fillText(
          translatedLines[index],
          x + width / 2,
          y + height / 2,
          Math.max(1, width)
        );
      });

      const ext = extension(file);
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      const outputExtension = mime === 'image/jpeg' ? 'jpg' : 'png';
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          value => value ? resolve(value) : reject(new Error('Не удалось создать переведённое изображение.')),
          mime,
          0.94
        );
      });

      setTranslatedAsset(blob, file, outputExtension);
      return { blob, text: translatedLines.join('\n') };
    } finally {
      URL.revokeObjectURL(objectUrl);
      image.onload = null;
      image.onerror = null;
      image.src = '';
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }

  function showTranslatedAssetPreview(blob) {
    const pane = $('resultPane');
    if (!pane || !blob) return;

    let preview = $('resultAssetPreview');
    if (preview?.dataset.objectUrl) {
      URL.revokeObjectURL(preview.dataset.objectUrl);
      preview.remove();
      preview = null;
    }

    const isPdf = blob.type === 'application/pdf';
    preview = document.createElement(isPdf ? 'iframe' : 'img');
    preview.id = 'resultAssetPreview';

    if (isPdf) {
      preview.title = 'Предпросмотр переведённого PDF';
      preview.style.cssText =
        'display:block;width:100%;height:70vh;min-height:420px;' +
        'border:0;border-radius:12px;margin:0 0 16px;';
    } else {
      preview.alt = 'Предпросмотр переведённого изображения';
      preview.style.cssText =
        'display:block;max-width:100%;max-height:560px;' +
        'object-fit:contain;margin:0 auto 16px;border-radius:12px;';
    }

    const url = URL.createObjectURL(blob);
    preview.src = url;
    preview.dataset.objectUrl = url;
    pane.prepend(preview);
  }



  function clearTranslatedAssetPreview() {
    const preview = $('resultAssetPreview');
    if (!preview) return;
    if (preview.dataset.objectUrl) {
      URL.revokeObjectURL(preview.dataset.objectUrl);
    }
    preview.remove();
  }

  // Показ результата
  function showResult(file, text) {
    if ($('resultMeta')) {
      $('resultMeta').textContent =
        `${file?.name || 'Текст'} · ` +
        `${text.length.toLocaleString('ru-RU')} символов`;
    }

    if ($('resultText')) {
      $('resultText').textContent = text;
    }

    if ($('resultNote')) {
      const ext = file ? extension(file) : '';
      if (ext === 'docx' || ext === 'epub' || ext === 'fb2') {
        $('resultNote').textContent =
          'Готовый файл сохраняет исходную структуру и ресурсы: изображения, обложку, таблицы и стили. Проверьте переносы и оформление отдельных фрагментов.';
      } else if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') {
        $('resultNote').textContent =
          'Готовое изображение можно скачать. Исходная картинка сохранена; фон под распознанным текстом восстанавливается приближённо — проверьте результат.';
      } else if (ext === 'pdf') {
        const textLayerNote = lastPdfTextLayerStatus === 'enabled'
          ? 'Добавлен невидимый текстовый слой для поиска и копирования перевода.'
          : lastPdfTextLayerStatus === 'unsupported-language'
            ? 'Для выбранного языка пока нет подходящего встроенного шрифта, поэтому невидимый текстовый слой не добавлен.'
            : 'Не удалось загрузить шрифт текстового слоя; видимый PDF всё равно собран.';
        $('resultNote').textContent =
          'Страницы и иллюстрации сохраняются как изображения. ' +
          textLayerNote +
          ' Само оформление PDF не редактируется, а фон под распознанным текстом восстанавливается приближённо. Проверьте результат в PDF-просмотрщике.';
      } else {
        $('resultNote').textContent =
          'Результат можно скопировать или скачать как TXT. Сохранение исходного оформления для этого формата ещё не подключено.';
      }
    }

    $('resultWrap')?.classList.remove('hidden');
  }

  // Очистка выбранного файла
  function clearSelection() {
    selectedFile = null;
    selectedFileText = '';
    translatedAssetBlob = null;
    translatedAssetName = '';
    lastOcrLines = [];
    lastOcrLanguage = '';
    clearTranslatedAssetPreview();

    if ($('fileInput')) {
      $('fileInput').value = '';
    }

    if ($('galleryInput')) {
      $('galleryInput').value = '';
    }

    $('fileChip')?.classList.add('is-hidden');

    if ($('fileChipName')) {
      $('fileChipName').textContent = '';
    }

    if ($('fileChipMeta')) {
      $('fileChipMeta').textContent = '';
    }

    if ($('photoPreview')) {
      $('photoPreview').innerHTML =
        '<p class="mk-photo__empty">' +
        'Фото страницы, скриншот или скан — ' +
        'текст распознаётся и переводится.' +
        '</p>';
    }
  }

  // Копирование и скачивание
  function bindDownloads() {
    $('copyBtn')?.addEventListener(
      'click',
      async () => {
        const text = $('resultText')?.textContent || '';

        if (!text) return;

        try {
          await navigator.clipboard.writeText(text);
        } catch (_) {
          showError(
            'Не удалось открыть буфер обмена. ' +
            'Выделите текст результата и скопируйте вручную.'
          );
        }
      }
    );

    $('downloadBtn')?.addEventListener(
      'click',
      () => {
        const text = $('resultText')?.textContent || '';

        if (translatedAssetBlob) {
          const assetUrl = URL.createObjectURL(translatedAssetBlob);
          const assetLink = document.createElement('a');
          assetLink.href = assetUrl;
          assetLink.download = translatedAssetName || 'mirror-info-translation';
          document.body.appendChild(assetLink);
          assetLink.click();
          assetLink.remove();
          setTimeout(() => URL.revokeObjectURL(assetUrl), 1500);
          return;
        }

        if (!text) return;

        const blob = new Blob(
          ['\uFEFF', text],
          { type: 'text/plain;charset=utf-8' }
        );

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mirror-info-translation.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    );
  }

  // Запуск приложения
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      const fileInput = $('fileInput');
      const galleryInput = $('galleryInput');
      const dropZone = $('dropZone');
      const textInput = $('textInput');
      const translateBtn = $('translateBtn');

      bindDownloads();

      // Выбор и чтение файла
      async function chooseFile(file, isPhoto = false) {
        if (!file) return;

        clearError();

        selectedFile = file;
        selectedFileText = '';
        translatedAssetBlob = null;
        translatedAssetName = '';
        lastOcrLines = [];
        lastOcrLanguage = '';
        clearTranslatedAssetPreview();
        $('resultWrap')?.classList.add('hidden');

        updateFileChip(file);

        if (isPhoto || file.type.startsWith('image/')) {
          previewImage(file);
        }

        progress(3, 'Проверяем файл…');

        try {
          selectedFileText = await extractFile(file);

          if (!selectedFileText.trim()) {
            throw new Error(
              'Текст не найден. Возможно, скан нечёткий ' +
              'или документ защищён от копирования. ' +
              'Попробуйте другой файл.'
            );
          }

          if (textInput) {
            textInput.value = selectedFileText;
          }

          progress(
            100,
            'Файл прочитан. Можно переводить.'
          );

          setTimeout(hideProgress, 900);

        } catch (error) {
          hideProgress();

          showError(
            error.message || 'Не удалось прочитать файл.'
          );
        }
      }

      fileInput?.addEventListener(
        'change',
        () => chooseFile(fileInput.files?.[0])
      );

      galleryInput?.addEventListener(
        'change',
        () => chooseFile(
          galleryInput.files?.[0],
          true
        )
      );

      $('pickGalleryBtn')?.addEventListener(
        'click',
        () => galleryInput?.click()
      );

      $('fileRemove')?.addEventListener(
        'click',
        clearSelection
      );

      dropZone?.addEventListener(
        'click',
        () => fileInput?.click()
      );

      dropZone?.addEventListener(
        'keydown',
        event => {
          if (
            event.key === 'Enter' ||
            event.key === ' '
          ) {
            event.preventDefault();
            fileInput?.click();
          }
        }
      );

      ['dragenter', 'dragover'].forEach(name => {
        dropZone?.addEventListener(name, event => {
          event.preventDefault();
          dropZone.classList.add('is-dragover');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        dropZone?.addEventListener(name, event => {
          event.preventDefault();
          dropZone.classList.remove('is-dragover');
        });
      });

      dropZone?.addEventListener(
        'drop',
        event => {
          const file = event.dataTransfer?.files?.[0];

          if (file) chooseFile(file);
        }
      );

      // Полная очистка
      $('clearBtn')?.addEventListener(
        'click',
        () => {
          clearSelection();

          if (textInput) {
            textInput.value = '';
          }

          clearError();

          $('resultWrap')?.classList.add('hidden');

          hideProgress();
        }
      );

      // Кнопка перевода
      translateBtn?.addEventListener(
        'click',
        async () => {
          clearError();

          let source = (
            textInput?.value || ''
          ).trim();

          if (!source && selectedFileText) {
            source = selectedFileText.trim();
          }

          if (!source) {
            showError(
              'Сначала загрузите файл или введите текст.'
            );
            return;
          }

          translateBtn.disabled = true;

          try {
            $('resultWrap')?.classList.add('hidden');

            progress(
              70,
              'Подготавливаем перевод…'
            );

            const ext = selectedFile ? extension(selectedFile) : '';
            let result;
            let asset = null;

            if (selectedFile && ext === 'docx') {
              const packaged = await translateDocxPackage(selectedFile);
              result = packaged.text;
              asset = packaged.blob;
              setTranslatedAsset(asset, selectedFile, 'docx');
            } else if (selectedFile && ext === 'epub') {
              const packaged = await translateEpubPackage(selectedFile);
              result = packaged.text;
              asset = packaged.blob;
              setTranslatedAsset(asset, selectedFile, 'epub');
            } else if (selectedFile && ext === 'fb2') {
              const packaged = await translateFb2Package(selectedFile);
              result = packaged.text;
              asset = packaged.blob;
              setTranslatedAsset(asset, selectedFile, 'fb2');
            } else if (selectedFile && ext === 'pdf') {
              const packaged = await translatePdfPackage(selectedFile);
              result = packaged.text;
              asset = packaged.blob;
              setTranslatedAsset(asset, selectedFile, 'pdf');
            } else if (selectedFile && (selectedFile.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'].includes(ext))) {
              const translatedImage = await translateImageFile(selectedFile);
              result = translatedImage.text;
              asset = translatedImage.blob;
            } else {
              result = await translateInParts(source);
            }

            showResult(selectedFile, result);
            if (asset) showTranslatedAssetPreview(asset);

            progress(
              100,
              'Перевод готов.'
            );

            setTimeout(hideProgress, 800);

          } catch (error) {
            hideProgress();

            showError(
              error.message ||
              'Сервис перевода временно недоступен. Попробуйте позже.'
            );

          } finally {
            translateBtn.disabled = false;
          }
        }
      );
    }
  );
})();
