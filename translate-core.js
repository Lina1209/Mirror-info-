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

    const url = URL.createObjectURL(file);

    target.replaceChildren();

    const img = document.createElement('img');

    img.src = url;
    img.alt = 'Предпросмотр загруженного изображения';

    img.style.cssText =
      'max-width:100%;max-height:280px;' +
      'object-fit:contain;border-radius:14px;';

    img.onload = () => URL.revokeObjectURL(url);

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
    const pdfjs = await ensurePdfJs();

    const pdf = await pdfjs.getDocument({
      data: await file.arrayBuffer()
    }).promise;

    const pages = [];

    for (
      let pageNo = 1;
      pageNo <= pdf.numPages;
      pageNo++
    ) {
      progress(
        5 + pageNo / pdf.numPages * 65,
        `Читаем PDF: страница ${pageNo} из ${pdf.numPages}…`
      );

      const page = await pdf.getPage(pageNo);

      const content = await page.getTextContent();

      let text = content.items
        .map(item => item.str || '')
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim();

      if (text.length < 25) {
        const viewport = page.getViewport({
          scale: 1.5
        });

        const canvas = document.createElement('canvas');

        const context = canvas.getContext('2d', {
          willReadFrequently: true
        });

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        await page.render({
          canvasContext: context,
          viewport
        }).promise;

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
          cut = maxLength;
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
    const sourcePdf = await pdfjs.getDocument({
      data: await file.arrayBuffer(),
      isEvalSupported: false
    }).promise;

    let outputPdf = null;
    const previewParts = [];

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

          lines.forEach((line, index) => {
            const box = line.bbox;
            const x = Math.max(0, Math.floor(box.x0));
            const y = Math.max(0, Math.floor(box.y0));
            const width = Math.max(1, Math.min(canvas.width - x, Math.ceil(box.x1 - box.x0)));
            const height = Math.max(1, Math.min(canvas.height - y, Math.ceil(box.y1 - box.y0)));
            if (x >= canvas.width || y >= canvas.height) return;

            context.fillStyle = sampleBackgroundColor(context, box, canvas.width, canvas.height);
            context.fillRect(Math.max(0, x - 2), Math.max(0, y - 1), width + 4, height + 2);

            let fontSize = Math.max(7, Math.min(30, height * 0.78));
            context.font = '600 ' + fontSize + 'px Arial, sans-serif';
            context.textAlign = 'left';
            context.textBaseline = 'middle';

            while (
              fontSize > 6 &&
              context.measureText(translatedLines[index]).width > width + 2
            ) {
              fontSize -= 1;
              context.font = '600 ' + fontSize + 'px Arial, sans-serif';
            }

            context.fillStyle = '#202020';
            context.fillText(
              translatedLines[index],
              x,
              y + height / 2,
              Math.max(1, width)
            );
          });

          const pageWidth = viewport.width / scale;
          const pageHeight = viewport.height / scale;
          const orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';
          const pageImage = canvas.toDataURL('image/jpeg', 0.92);

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

          outputPdf.addImage(pageImage, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
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

      const blob = outputPdf.output('blob');
      return {
        blob,
        text: previewParts.join('\n\n') || 'Текст на страницах PDF не распознан.'
      };
    } finally {
      try {
        await sourcePdf.destroy();
      } catch (_) {
        // Освобождение PDF.js ресурсов не должно заменять исходную ошибку.
      }
    }
  }

  async function translateDocxPackage(file) {
    const JSZip = await ensureJSZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = zip.file(/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/i);

    if (!entries.length) {
      throw new Error('В DOCX не найдена основная структура Word.');
    }

    const previewParts = [];
    for (const entry of entries) {
      const doc = new DOMParser().parseFromString(await entry.async('text'), 'application/xml');
      if (doc.querySelector('parsererror')) {
        throw new Error('Не удалось прочитать часть DOCX: ' + entry.name);
      }

      const paragraphs = Array.from(doc.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'p'
      ));

      for (let index = 0; index < paragraphs.length; index += 1) {
        const textNodes = Array.from(paragraphs[index].getElementsByTagNameNS(
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
          't'
        ));
        const source = textNodes.map(node => node.textContent || '').join('');
        if (!source.trim()) continue;

        const leading = source.match(/^\s*/)?.[0] || '';
        const trailing = source.match(/\s*$/)?.[0] || '';
        const translated = await translateInParts(source.trim());
        previewParts.push(translated);
        distributeTranslatedText(leading + translated + trailing, textNodes);
      }

      zip.file(entry.name, new XMLSerializer().serializeToString(doc));
    }

    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    return {
      blob,
      text: previewParts.join('\n\n') || 'В DOCX не найден текст для перевода.'
    };
  }

  async function translateEpubPackage(file) {
    const JSZip = await ensureJSZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = zip.file(/\.(xhtml|html|htm)$/i).filter(entry => !entry.dir);

    if (!entries.length) {
      throw new Error('В EPUB не найдены главы XHTML/HTML.');
    }

    const previewParts = [];
    const selector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,figcaption,caption,dt,dd';

    for (const entry of entries) {
      const xml = await entry.async('text');
      const updated = await translateXmlBlocks(xml, selector, 'главы EPUB', previewParts);
      zip.file(entry.name, updated);
    }

    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/epub+zip'
    });

    return {
      blob,
      text: previewParts.join('\n\n') || 'В EPUB не найден текст для перевода.'
    };
  }



  async function translateFb2Package(file) {
    const xml = await readText(file);
    const previewParts = [];
    const updated = await translateXmlBlocks(
      xml,
      'p,subtitle,title',
      'текст FB2',
      previewParts
    );
    return {
      blob: new Blob([updated], { type: 'application/x-fictionbook+xml;charset=utf-8' }),
      text: previewParts.join('\n\n') || 'В FB2 не найден текст для перевода.'
    };
  }

  function sampleBackgroundColor(context, box, width, height) {
    const left = Math.max(0, Math.floor(box.x0));
    const right = Math.min(width - 1, Math.ceil(box.x1));
    const top = Math.max(0, Math.floor(box.y0));
    const bottom = Math.min(height - 1, Math.ceil(box.y1));
    const samples = [];
    const horizontalStep = Math.max(2, Math.floor((right - left) / 12));
    const verticalStep = Math.max(2, Math.floor((bottom - top) / 8));

    // Берём точки по четырём сторонам рамки; медиана меньше зависит
    // от отдельных тёмных пикселей, линий и случайных деталей фона.
    for (let x = left; x <= right; x += horizontalStep) {
      for (const y of [
        Math.max(0, top - 3),
        Math.min(height - 1, bottom + 3)
      ]) {
        const pixel = context.getImageData(x, y, 1, 1).data;
        samples.push([pixel[0], pixel[1], pixel[2]]);
      }
    }

    for (let y = top; y <= bottom; y += verticalStep) {
      for (const x of [
        Math.max(0, left - 3),
        Math.min(width - 1, right + 3)
      ]) {
        const pixel = context.getImageData(x, y, 1, 1).data;
        samples.push([pixel[0], pixel[1], pixel[2]]);
      }
    }

    if (!samples.length) return 'rgba(255,255,255,0.95)';

    const median = [0, 1, 2].map(channel => {
      const values = samples.map(pixel => pixel[channel]).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return Math.round(values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2);
    });

    return 'rgba(' + median[0] + ',' + median[1] + ',' + median[2] + ',0.96)';
  }

  async function translateImageFile(file) {
    const currentOcrLanguage = $('srcLang')?.value || 'auto';
    if (lastOcrLanguage !== currentOcrLanguage) {
      lastOcrLines = [];
      await ocrImage(file);
    }
    const lines = lastOcrLines.filter(line => line.text && line.text.trim() && line.bbox);
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
      throw new Error('Изображение слишком большое для безопасной обработки в браузере. Уменьшите его размер и повторите попытку.');
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

      context.fillStyle = sampleBackgroundColor(context, box, canvas.width, canvas.height);
      context.fillRect(Math.max(0, x - 2), Math.max(0, y - 1), width + 4, height + 2);

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
        $('resultNote').textContent =
          'Страницы, размер и иллюстрации PDF сохраняются как изображения высокого разрешения. Текстовый слой в новом PDF пока не редактируется; фон под текстом восстанавливается приближённо.';
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
            } else if (selectedFile && ['jpg', 'jpeg', 'png'].includes(ext)) {
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
