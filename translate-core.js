(function (window) {
  'use strict';

  const API_URL = '/api/translate';
  const MAX_CHUNK_CHARS = 1000;
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const SUPPORTED_TEXT = new Set(['txt', 'md', 'markdown', 'log', 'srt', 'vtt']);

  async function translateChunk(text, sourceLang, targetLang) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
      try {
        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({ text, sourceLang, targetLang })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 404 || response.status === 405) {
            throw new Error('API перевода не найдена. Опубликуйте проект на Cloudflare Pages: GitHub Pages не запускает Functions.');
          }
          const error = new Error(data.error || `Ошибка перевода (${response.status}).`);
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        if (typeof data.translation !== 'string') throw new Error('Сервис вернул некорректный перевод.');
        return data.translation;
      } catch (error) {
        lastError = error;
        if (error.name === 'AbortError') lastError = new Error('Запрос перевода превысил 25 секунд. Проверьте Cloudflare Functions и повторите попытку.');
        const canRetry = attempt === 0 && (error.name === 'AbortError' || error.retryable || error instanceof TypeError);
        if (!canRetry) throw lastError;
        await new Promise((resolve) => setTimeout(resolve, 600));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError || new Error('Не удалось выполнить перевод.');
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

  window.AppAPI = { translate: translateChunk, getExchangeRates, submitOrder };

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('translateBtn');
    const fileInput = document.getElementById('fileInput');
    const textInput = document.getElementById('textInput');
    const dropZone = document.getElementById('dropZone');
    const resultText = document.getElementById('resultText');
    const byId = (id) => document.getElementById(id);
    if (!button || !fileInput) return;

    let selectedFile = null;
    let resultBlob = null;
    let resultFilename = 'mirror-translation.txt';

    function setProgress(percent, label) {
      byId('progressWrap')?.classList.remove('hidden');
      if (byId('progressBar')) byId('progressBar').style.width = `${percent}%`;
      if (byId('progressPercent')) byId('progressPercent').textContent = `${Math.round(percent)}%`;
      if (byId('progressLabel')) byId('progressLabel').textContent = label;
    }
    function showError(message) {
      if (byId('errorText')) byId('errorText').textContent = message;
      byId('errorWrap')?.classList.remove('hidden');
    }
    function clearError() { byId('errorWrap')?.classList.add('hidden'); }
    function selectFile(file) {
      selectedFile = file;
      if (byId('fileChipName')) byId('fileChipName').textContent = file.name;
      if (byId('fileChipMeta')) byId('fileChipMeta').textContent = `${(file.size / 1024).toFixed(1)} KB`;
      byId('fileChip')?.classList.remove('is-hidden');
      clearError();
    }

    async function translateLongText(source, progress) {
      const sourceLang = byId('srcLang')?.value || 'auto';
      const targetLang = byId('tgtLang')?.value || 'ru';
      const chunks = [];
      for (let offset = 0; offset < source.length;) {
        let end = Math.min(offset + MAX_CHUNK_CHARS, source.length);
        if (end < source.length) {
          const candidates = ['\n\n', '\n', '. ', ' '].map((separator) => source.lastIndexOf(separator, end));
          const boundary = Math.max(...candidates);
          if (boundary > offset + MAX_CHUNK_CHARS * 0.55) end = boundary + 1;
        }
        chunks.push(source.slice(offset, end));
        offset = end;
      }
      let translated = '';
      for (let index = 0; index < chunks.length; index++) {
        translated += await translateChunk(chunks[index], sourceLang, targetLang);
        progress((index + 1) / chunks.length);
      }
      return translated;
    }

    async function runTranslation() {
      clearError();
      byId('resultWrap')?.classList.add('hidden');
      const pastedText = textInput?.value.trim() || '';
      if (!selectedFile && !pastedText) throw new Error('Выберите текстовый файл или введите текст.');
      if (selectedFile && selectedFile.size > MAX_FILE_BYTES) throw new Error('Файл больше 5 МБ. Разделите его на части и повторите попытку.');

      let source = pastedText;
      let extension = 'txt';
      if (selectedFile) {
        extension = selectedFile.name.split('.').pop().toLowerCase();
        if (!SUPPORTED_TEXT.has(extension)) {
          throw new Error('На этом этапе поддерживаются TXT, MD, LOG, SRT и VTT. DOCX/EPUB/PDF и другие форматы пока не обрабатываются: выберите текстовый файл, чтобы не получить повреждённый документ.');
        }
        setProgress(3, 'Читаем файл…');
        source = await selectedFile.text();
      }
      if (!source.trim()) throw new Error('Файл пустой — переводить нечего.');
      if (source.length > 200_000) throw new Error('Текст превышает лимит 200 000 символов. Разделите файл на несколько частей.');

      setProgress(8, 'Подключаем сервис перевода…');
      const translated = await translateLongText(source, (fraction) => setProgress(8 + fraction * 90, `Переводим фрагмент… ${Math.round(fraction * 100)}%`));
      if (!translated.trim()) throw new Error('Сервис вернул пустой перевод. Попробуйте ещё раз.');

      resultBlob = new Blob([translated], { type: 'text/plain;charset=utf-8' });
      const stem = (selectedFile?.name || 'mirror-translation').replace(/\.[^.]+$/, '');
      resultFilename = `${stem}-translated.${SUPPORTED_TEXT.has(extension) ? extension : 'txt'}`;
      if (resultText) resultText.textContent = translated;
      if (byId('resultMeta')) byId('resultMeta').textContent = `${byId('srcLang')?.value || 'auto'} → ${byId('tgtLang')?.value || 'ru'} · ${translated.length.toLocaleString('ru-RU')} символов`;
      if (byId('resultNote')) byId('resultNote').textContent = 'Предпросмотр готов. Результат скачивается как текстовый файл; исходная вёрстка DOCX/PDF и OCR пока не поддерживаются.';
      byId('resultWrap')?.classList.remove('hidden');
      setProgress(100, 'Перевод завершён');
      setTimeout(() => byId('progressWrap')?.classList.add('hidden'), 900);
    }

    fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) selectFile(file); });
    dropZone?.addEventListener('click', () => fileInput.click());
    dropZone?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); } });
    dropZone?.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
    dropZone?.addEventListener('drop', (event) => {
      event.preventDefault(); dropZone.classList.remove('is-dragging');
      const file = event.dataTransfer?.files?.[0];
      if (file) { selectFile(file); try { const transfer = new DataTransfer(); transfer.items.add(file); fileInput.files = transfer.files; } catch (_) {} }
    });
    byId('fileRemove')?.addEventListener('click', () => { selectedFile = null; fileInput.value = ''; byId('fileChip')?.classList.add('is-hidden'); });
    byId('translateBtn')?.addEventListener('click', async () => {
      button.disabled = true; button.setAttribute('aria-busy', 'true');
      try { await runTranslation(); }
      catch (error) { byId('progressWrap')?.classList.add('hidden'); showError(error.message || 'Не удалось завершить перевод.'); }
      finally { button.disabled = false; button.removeAttribute('aria-busy'); }
    });
    byId('downloadBtn')?.addEventListener('click', () => {
      if (!resultBlob) return;
      const url = URL.createObjectURL(resultBlob); const link = document.createElement('a');
      link.href = url; link.download = resultFilename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    byId('copyBtn')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(resultText?.textContent || ''); }
      catch (_) { showError('Буфер обмена недоступен. Выделите текст предпросмотра и скопируйте вручную.'); }
    });
    byId('viewBtn')?.addEventListener('click', () => resultText?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    byId('clearBtn')?.addEventListener('click', () => {
      if (textInput) textInput.value = '';
      selectedFile = null; resultBlob = null; fileInput.value = '';
      byId('fileChip')?.classList.add('is-hidden'); byId('resultWrap')?.classList.add('hidden');
      byId('progressWrap')?.classList.add('hidden'); clearError();
    });
  });
})(window);
