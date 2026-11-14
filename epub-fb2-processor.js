/* Mirror-info: preservation-first EPUB / FB2 processor.
 * Requires JSZip. Uses a supplied async translator callback.
 * Translates readable text nodes while leaving markup, attributes, styles,
 * images, fonts, cover references and package metadata untouched.
 */
(function (global) {
  'use strict';

  const XML_MIME = 'application/xml';
  const EPUB_MIME = 'application/epub+zip';

  function parseXml(source, label) {
    const doc = new DOMParser().parseFromString(source, XML_MIME);
    if (doc.querySelector('parsererror')) throw new Error(label + ': некорректный XML.');
    return doc;
  }

  function localName(node) { return (node && node.localName) || ''; }

  function textNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const blocked = parent.closest('script,style,code,pre,svg,math,[translate="no"],.notranslate');
        return blocked ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const out = [];
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }

  async function translateXmlDocument(source, translateText, label) {
    const doc = parseXml(source, label);
    const nodes = textNodes(doc.documentElement);
    for (const node of nodes) {
      const original = node.nodeValue;
      const leading = (original.match(/^\s*/) || [''])[0];
      const trailing = (original.match(/\s*$/) || [''])[0];
      const core = original.slice(leading.length, original.length - trailing.length);
      if (!core) continue;
      const translated = await translateText(core);
      if (typeof translated === 'string' && translated.trim()) {
        node.nodeValue = leading + translated + trailing;
      }
    }
    return new XMLSerializer().serializeToString(doc);
  }

  function dirname(path) {
    const i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i + 1);
  }

  function resolveZipPath(baseFile, href) {
    const clean = String(href || '').split('#')[0].split('?')[0];
    let decoded;
    try { decoded = decodeURIComponent(clean); } catch (_) { decoded = clean; }
    const joined = decoded.startsWith('/') ? decoded.slice(1) : dirname(baseFile) + decoded;
    const stack = [];
    for (const part of joined.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    return stack.join('/');
  }

  async function getZip() {
    if (global.JSZip) return global.JSZip;
    throw new Error('Для обработки EPUB требуется подключённая библиотека JSZip.');
  }

  async function translateEpub(file, translateText, onProgress) {
    const JSZip = await getZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('В EPUB отсутствует META-INF/container.xml.');
    const container = parseXml(await containerFile.async('text'), 'container.xml');
    const rootfile = Array.from(container.getElementsByTagName('*'))
      .find(n => localName(n) === 'rootfile')?.getAttribute('full-path');
    if (!rootfile || !zip.file(rootfile)) throw new Error('Не найден OPF-файл книги EPUB.');

    const opf = parseXml(await zip.file(rootfile).async('text'), 'OPF');
    const manifest = new Map();
    const spineIds = [];
    for (const node of Array.from(opf.getElementsByTagName('*'))) {
      if (localName(node) === 'item') {
        manifest.set(node.getAttribute('id'), {
          href: node.getAttribute('href'),
          type: node.getAttribute('media-type') || ''
        });
      } else if (localName(node) === 'itemref') {
        spineIds.push(node.getAttribute('idref'));
      }
    }

    const targets = [];
    for (const id of spineIds) {
      const item = manifest.get(id);
      if (!item || !/xhtml|html/i.test(item.type)) continue;
      const path = resolveZipPath(rootfile, item.href);
      if (zip.file(path)) targets.push(path);
    }
    if (!targets.length) throw new Error('В EPUB не найдены XHTML/HTML-разделы для перевода.');

    let done = 0;
    for (const path of targets) {
      const source = await zip.file(path).async('text');
      const translated = await translateXmlDocument(source, translateText, path);
      zip.file(path, translated);
      done++;
      if (onProgress) onProgress(done, targets.length, path);
    }

    // JSZip writes a valid ZIP. Explicitly store mimetype as the first uncompressed entry.
    const mimeEntry = zip.file('mimetype');
    if (!mimeEntry) zip.file('mimetype', EPUB_MIME, { compression: 'STORE' });
    else {
      const mimeText = await mimeEntry.async('text');
      zip.file('mimetype', mimeText || EPUB_MIME, { compression: 'STORE' });
    }
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: EPUB_MIME,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
    return new File([blob], file.name.replace(/\.epub$/i, '') + '-translated.epub', { type: EPUB_MIME });
  }

  async function translateFb2(file, translateText, onProgress) {
    const bytes = await file.arrayBuffer();
    let xml;
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { xml = new TextDecoder('windows-1251').decode(bytes); }
    const doc = parseXml(xml, 'FB2');
    const root = doc.documentElement;
    const nodes = textNodes(root);
    let done = 0;
    for (const node of nodes) {
      const original = node.nodeValue;
      const leading = (original.match(/^\s*/) || [''])[0];
      const trailing = (original.match(/\s*$/) || [''])[0];
      const core = original.slice(leading.length, original.length - trailing.length);
      if (!core) continue;
      const translated = await translateText(core);
      if (typeof translated === 'string' && translated.trim()) node.nodeValue = leading + translated + trailing;
      done++;
      if (onProgress && done % 30 === 0) onProgress(done, nodes.length);
    }
    const output = new XMLSerializer().serializeToString(doc);
    return new File(['\uFEFF', output], file.name.replace(/\.fb2$/i, '') + '-translated.fb2', {
      type: 'application/x-fictionbook+xml;charset=utf-8'
    });
  }

  global.MirrorDocumentProcessor = Object.freeze({ translateEpub, translateFb2 });
})(window);
