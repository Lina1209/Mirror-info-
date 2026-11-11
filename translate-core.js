(function () {
  'use strict';

  function setError(message) {
    const wrap = document.getElementById('errorWrap');
    const text = document.getElementById('errorText');
    if (!wrap || !text) return;
    text.textContent = message || 'Произошла ошибка. Попробуйте ещё раз.';
    wrap.classList.remove('hidden');
  }

  function clearError() {
    const wrap = document.getElementById('errorWrap');
    if (wrap) wrap.classList.add('hidden');
  }

  function setProgress(percent, label) {
    const wrap = document.getElementById('progressWrap');
    const bar = document.getElementById('progressBar');
    const labelEl = document.getElementById('progressLabel');
    const percentEl = document.getElementById('progressPercent');

    if (!wrap || !bar || !labelEl || !percentEl) return;

    wrap.classList.remove('hidden');
    bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    labelEl.textContent = label || 'Готовим перевод…';
    percentEl.textContent = `${Math.round(percent)}%`;
  }

  function hideProgress() {
    const wrap = document.getElementById('progressWrap');
    if (wrap) wrap.classList.add('hidden');
  }

  function showResult(metaText, translatedText) {
    const resultWrap = document.getElementById('resultWrap');
    const meta = document.getElementById('resultMeta');
    const text = document.getElementById('resultText');
    const note = document.getElementById('resultNote');
    if (!resultWrap || !meta || !text || !note) return;

    meta.textContent = metaText || '';
    text.textContent = translatedText || '';
    note.textContent = 'Ваш текст готов. Его можно скопировать или сохранить.';
    resultWrap.classList.remove('hidden');
  }

  function parseTextFile(file) {
    return new Promise((resolve, reject) => {
      const name = file.name || '';
      const isTextLike = /\.(txt|md|csv|tsv|json|xml|html|htm|srt|vtt|log|ini|yml|yaml|rtf)$/i.test(name);
      if (!isTextLike) {
        reject(new Error('Поддерживаются текстовые файлы, DOCX, EPUB, FB2 и PDF.'));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
      reader.readAsText(file);
    });
  }

  async function runTranslateFlow(sourceText) {
    const sourceLang = document.getElementById('srcLang')?.value || 'auto';
    const targetLang = document.getElementById('tgtLang')?.value || 'ru';

    if (!sourceText || !sourceText.trim()) {
      throw new Error('Введите текст или загрузите документ для перевода.');
    }

    if (window.AppAPI && typeof window.AppAPI.translate === 'function') {
      return await window.AppAPI.translate(sourceText, sourceLang, targetLang);
    }

    return sourceText;
  }

  function bindCopyDownload() {
    const copyBtn = document.getElementById('copyBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const resultText = document.getElementById('resultText');

    copyBtn?.addEventListener('click', async () => {
      if (!resultText || !resultText.textContent.trim()) return;
      try {
        await navigator.clipboard.writeText(resultText.textContent);
      } catch (error) {
        setError('Буфер обмена недоступен. Скопируйте текст вручную.');
      }
    });

    downloadBtn?.addEventListener('click', () => {
      if (!resultText || !resultText.textContent.trim()) return;
      const blob = new Blob([resultText.textContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mirror-translation.txt';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const translateBtn = document.getElementById('translateBtn');
    const clearBtn = document.getElementById('clearBtn');
    const fileInput = document.getElementById('fileInput');
    const galleryInput = document.getElementById('galleryInput');
    const textInput = document.getElementById('textInput');
    const fileChip = document.getElementById('fileChip');
    const fileChipName = document.getElementById('fileChipName');
    const fileChipMeta = document.getElementById('fileChipMeta');
    const dropZone = document.getElementById('dropZone');
    const photoPreview = document.getElementById('photoPreview');

    bindCopyDownload();
    if (!translateBtn) return;

    const setSelectedFile = (file) => {
      if (!fileChip || !fileChipName || !fileChipMeta) return;
      fileChip.classList.remove('is-hidden');
      fileChipName.textContent = file.name;
      fileChipMeta.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    };

    const clearSelectedFile = () => {
      if (fileInput) fileInput.value = '';
      if (fileChip) fileChip.classList.add('is-hidden');
      if (fileChipName) fileChipName.textContent = '';
      if (fileChipMeta) fileChipMeta.textContent = '';
    };

    const fillPreviewFromImage = (file) => {
      if (!photoPreview || !file || !file.type.includes('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        photoPreview.innerHTML = `<img src="${reader.result}" alt="Предпросмотр изображения" style="max-height:260px;border-radius:16px;object-fit:cover;">`;
      };
      reader.readAsDataURL(file);
    };

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput?.click();
      }
    });

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      setSelectedFile(file);
      clearError();
      parseTextFile(file)
        .then((value) => {
          if (textInput) textInput.value = value;
        })
        .catch((error) => {
          setError(error.message || 'Не удалось загрузить документ.');
        });
    });

    galleryInput?.addEventListener('change', () => {
      const file = galleryInput.files && galleryInput.files[0];
      if (!file) return;
      fillPreviewFromImage(file);
      if (textInput) textInput.value = `Изображение: ${file.name}`;
    });

    clearBtn?.addEventListener('click', () => {
      if (textInput) textInput.value = '';
      clearSelectedFile();
      clearError();
      const resultWrap = document.getElementById('resultWrap');
      if (resultWrap) resultWrap.classList.add('hidden');
      if (photoPreview) photoPreview.innerHTML = '<p class="mk-photo__empty">Фото страницы, скриншот или скан — текст распознаётся и переводится.</p>';
    });

    translateBtn.addEventListener('click', async () => {
      clearError();
      setProgress(10, 'Подготовка текста…');
      let sourceText = textInput ? textInput.value.trim() : '';

      if (!sourceText && fileInput && fileInput.files && fileInput.files[0]) {
        try {
          sourceText = await parseTextFile(fileInput.files[0]);
          if (textInput) textInput.value = sourceText;
        } catch (error) {
          setError(error.message || 'Не удалось прочитать файл.');
          return;
        }
      }

      try {
        setProgress(35, 'Сканируем и готовим перевод…');
        const result = await runTranslateFlow(sourceText);
        setProgress(82, 'Собираем результат…');
        showResult(`${document.getElementById('srcLang')?.value || 'auto'} → ${document.getElementById('tgtLang')?.value || 'ru'}`, result);
        hideProgress();
      } catch (error) {
        hideProgress();
        setError(error.message || 'Сервис перевода временно недоступен.');
      }
    });
  });
})();
