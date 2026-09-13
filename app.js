(() => {
  'use strict';

  const DB_NAME = 'puppy-word-reader';
  const DB_VERSION = 2;
  const DOC_STORE = 'documents';
  const DICT_STORE = 'dictionary';
  const META_STORE = 'meta';
  const SETTINGS_KEY = 'puppy-reader-settings';
  const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,table,figure';

  const state = {
    db: null,
    currentDoc: null,
    saveTimer: null,
    lookupTimer: null,
    fontSize: 20,
    theme: 'system',
    dictCount: 0,
    speakingWord: '',
    lastLookupWord: '',
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    libraryView: $('libraryView'), readerView: $('readerView'), reader: $('reader'),
    docxInput: $('docxInput'), dictInput: $('dictInput'), docList: $('docList'), emptyDocs: $('emptyDocs'),
    homeBtn: $('homeBtn'), dictionaryBtn: $('dictionaryBtn'), dictionaryModal: $('dictionaryModal'),
    clearDictionaryBtn: $('clearDictionaryBtn'), clearDocsBtn: $('clearDocsBtn'),
    dictStatusTitle: $('dictStatusTitle'), dictStatusDetail: $('dictStatusDetail'),
    importProgressWrap: $('importProgressWrap'), importProgressBar: $('importProgressBar'), importProgressText: $('importProgressText'),
    appTitle: $('appTitle'), docTitle: $('docTitle'), fontMinusBtn: $('fontMinusBtn'), fontPlusBtn: $('fontPlusBtn'), themeBtn: $('themeBtn'),
    readingProgress: $('readingProgress').querySelector('span'), continueBtn: $('continueBtn'),
    lookupSheet: $('lookupSheet'), lookupWord: $('lookupWord'), lookupPhonetic: $('lookupPhonetic'), lookupPos: $('lookupPos'),
    lookupTranslation: $('lookupTranslation'), lookupHint: $('lookupHint'), speakBtn: $('speakBtn'), closeLookupBtn: $('closeLookupBtn'),
    toast: $('toast'), offlineDot: $('offlineDot'), offlineText: $('offlineText'),
  };

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DOC_STORE)) {
          const docs = db.createObjectStore(DOC_STORE, { keyPath: 'id' });
          docs.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(DICT_STORE)) {
          db.createObjectStore(DICT_STORE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllDocs() {
    const tx = state.db.transaction(DOC_STORE, 'readonly');
    const docs = await reqToPromise(tx.objectStore(DOC_STORE).getAll());
    return docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function getDoc(id) {
    const tx = state.db.transaction(DOC_STORE, 'readonly');
    return reqToPromise(tx.objectStore(DOC_STORE).get(id));
  }

  async function putDoc(doc) {
    const tx = state.db.transaction(DOC_STORE, 'readwrite');
    tx.objectStore(DOC_STORE).put(doc);
    await txDone(tx);
  }

  async function getMeta(key) {
    const tx = state.db.transaction(META_STORE, 'readonly');
    const row = await reqToPromise(tx.objectStore(META_STORE).get(key));
    return row ? row.value : null;
  }

  async function setMeta(key, value) {
    const tx = state.db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key, value });
    await txDone(tx);
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      state.fontSize = Math.min(30, Math.max(16, Number(s.fontSize) || 20));
      state.theme = ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system';
    } catch (_) {}
    applySettings();
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ fontSize: state.fontSize, theme: state.theme }));
  }

  function applySettings() {
    document.documentElement.style.setProperty('--reader-size', `${state.fontSize}px`);
    let actual = state.theme;
    if (actual === 'system') actual = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = actual;
    els.themeBtn.textContent = state.theme === 'system' ? '◐' : (state.theme === 'dark' ? '☾' : '☀');
  }

  function cycleTheme() {
    state.theme = state.theme === 'system' ? 'light' : state.theme === 'light' ? 'dark' : 'system';
    saveSettings();
    applySettings();
  }

  function fmtDate(ts) {
    if (!ts) return '';
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  }

  function fmtProgress(doc) {
    const p = Math.max(0, Math.min(1, Number(doc.progressRatio) || 0));
    return p < 0.01 ? '未开始' : p >= 0.995 ? '读完啦' : `${Math.round(p * 100)}%`;
  }

  function toast(message, ms = 2200) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => els.toast.classList.add('hidden'), ms);
  }

  async function renderLibrary() {
    const docs = await getAllDocs();
    els.docList.innerHTML = '';
    els.emptyDocs.classList.toggle('hidden', docs.length > 0);
    for (const doc of docs) {
      const btn = document.createElement('button');
      btn.className = 'doc-item';
      btn.type = 'button';
      btn.innerHTML = `
        <div class="doc-name"></div>
        <div class="doc-progress"></div>
        <div class="doc-meta"></div>
      `;
      btn.querySelector('.doc-name').textContent = doc.name || '未命名故事';
      btn.querySelector('.doc-progress').textContent = fmtProgress(doc);
      btn.querySelector('.doc-meta').textContent = `上次阅读 ${fmtDate(doc.updatedAt)}`;
      btn.addEventListener('click', () => openStoredDoc(doc.id));
      els.docList.appendChild(btn);
    }
  }

  function setView(mode) {
    const reading = mode === 'reader';
    els.libraryView.classList.toggle('hidden', reading);
    els.readerView.classList.toggle('hidden', !reading);
    document.querySelectorAll('.reader-only').forEach(el => el.classList.toggle('hidden', !reading));
    els.docTitle.textContent = reading && state.currentDoc ? state.currentDoc.name : '';
    els.appTitle.textContent = reading ? '小狗单词故事' : '小狗单词故事';
    if (!reading) {
      closeLookup();
      state.currentDoc = null;
      history.replaceState(null, '', location.pathname + location.search);
      window.scrollTo(0, 0);
    }
  }

  async function digestFile(arrayBuffer) {
    if (crypto?.subtle) {
      const hash = await crypto.subtle.digest('SHA-256', arrayBuffer);
      return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
    }
    return `${Date.now()}-${arrayBuffer.byteLength}`;
  }

  function assignReaderBlocks() {
    const blocks = [...els.reader.querySelectorAll(BLOCK_SELECTOR)];
    blocks.forEach((el, i) => { el.dataset.readerBlock = String(i); });
    return blocks;
  }

  function sanitizeMammothHtml(html) {
    if (!window.DOMPurify) return html;
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target'],
      FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option'],
    });
  }

  async function importDocx(file) {
    if (!window.mammoth) {
      toast('Word 解析组件还没加载好。第一次打开需要联网完成应用缓存。', 4200);
      return;
    }
    if (!file.name.toLowerCase().endsWith('.docx')) {
      toast('请选择 .docx 文件');
      return;
    }
    toast('正在打开 Word…', 1200);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const id = await digestFile(arrayBuffer);
      const old = await getDoc(id);
      if (old) {
        await openStoredDoc(id);
        return;
      }
      const result = await mammoth.convertToHtml({ arrayBuffer }, {
        includeDefaultStyleMap: true,
      });
      const html = sanitizeMammothHtml(result.value);
      const now = Date.now();
      const doc = {
        id,
        name: file.name.replace(/\.docx$/i, ''),
        html,
        createdAt: now,
        updatedAt: now,
        progressRatio: 0,
        progressBlock: 0,
        scrollY: 0,
      };
      await putDoc(doc);
      await renderLibrary();
      await openStoredDoc(id);
      if (result.messages?.length) console.info('Mammoth messages:', result.messages);
    } catch (err) {
      console.error(err);
      toast(`打开失败：${err.message || err}`, 4500);
    } finally {
      els.docxInput.value = '';
    }
  }

  async function openStoredDoc(id) {
    const doc = await getDoc(id);
    if (!doc) return;
    state.currentDoc = doc;
    els.reader.innerHTML = doc.html;
    assignReaderBlocks();
    setView('reader');
    history.replaceState({ docId: id }, '', `${location.pathname}${location.search}#read=${encodeURIComponent(id)}`);

    requestAnimationFrame(() => {
      restorePosition(doc);
      updateProgressUI();
      els.reader.focus({ preventScroll: true });
    });
  }

  function restorePosition(doc) {
    const block = els.reader.querySelector(`[data-reader-block="${Number(doc.progressBlock) || 0}"]`);
    if (block && (doc.progressBlock || 0) > 0) {
      const y = block.getBoundingClientRect().top + window.scrollY - 78;
      window.scrollTo(0, Math.max(0, y));
    } else if (Number(doc.scrollY) > 0) {
      window.scrollTo(0, Number(doc.scrollY));
    } else {
      window.scrollTo(0, 0);
    }
  }

  function getProgressSnapshot() {
    if (!state.currentDoc) return null;
    const blocks = [...els.reader.querySelectorAll('[data-reader-block]')];
    const targetY = 92;
    let current = blocks[0] || null;
    for (const el of blocks) {
      const r = el.getBoundingClientRect();
      if (r.top <= targetY) current = el;
      else break;
    }
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    return {
      progressBlock: current ? Number(current.dataset.readerBlock) || 0 : 0,
      progressRatio: Math.max(0, Math.min(1, window.scrollY / maxScroll)),
      scrollY: window.scrollY,
    };
  }

  function scheduleProgressSave() {
    if (!state.currentDoc) return;
    updateProgressUI();
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveProgress, 350);
  }

  async function saveProgress() {
    if (!state.currentDoc) return;
    const snap = getProgressSnapshot();
    if (!snap) return;
    Object.assign(state.currentDoc, snap, { updatedAt: Date.now() });
    try { await putDoc(state.currentDoc); } catch (e) { console.warn('Progress save failed', e); }
  }

  function updateProgressUI() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const ratio = Math.max(0, Math.min(1, window.scrollY / maxScroll));
    els.readingProgress.style.width = `${ratio * 100}%`;
  }

  function normalizeSelectedWord(text) {
    if (!text) return '';
    let s = text.normalize('NFKC').trim();
    s = s.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ'’-]+|[^A-Za-zÀ-ÖØ-öø-ÿ'’-]+$/g, '');
    if (!s || s.length > 80 || /\s/.test(s)) return '';
    return s.replace(/[’]/g, "'");
  }

  function selectedWordFromWindow() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!node || !els.reader.contains(node)) return '';
    return normalizeSelectedWord(sel.toString());
  }

  async function lookupKey(key) {
    const tx = state.db.transaction(DICT_STORE, 'readonly');
    return reqToPromise(tx.objectStore(DICT_STORE).get(key.toLowerCase()));
  }

  function getLemmaFromExchange(exchange) {
    if (!exchange) return '';
    const part = String(exchange).split('/').find(x => x.startsWith('0:'));
    return part ? part.slice(2).trim().toLowerCase() : '';
  }

  function fallbackLemmas(word) {
    const w = word.toLowerCase();
    const out = [];
    if (w.endsWith("'s")) out.push(w.slice(0, -2));
    if (w.endsWith('ies') && w.length > 4) out.push(w.slice(0, -3) + 'y');
    if (w.endsWith('ing') && w.length > 5) { out.push(w.slice(0, -3)); out.push(w.slice(0, -3) + 'e'); }
    if (w.endsWith('ed') && w.length > 4) { out.push(w.slice(0, -2)); out.push(w.slice(0, -1)); }
    if (w.endsWith('es') && w.length > 4) out.push(w.slice(0, -2));
    if (w.endsWith('s') && w.length > 3) out.push(w.slice(0, -1));
    return [...new Set(out)];
  }

  async function lookupWord(rawWord) {
    const word = normalizeSelectedWord(rawWord);
    if (!word) return;
    state.lastLookupWord = word;
    showLookupLoading(word);

    if (!state.dictCount) {
      showLookupMissingDictionary(word);
      return;
    }

    try {
      const key = word.toLowerCase();
      let row = await lookupKey(key);
      let lemmaRow = null;
      if (row) {
        const lemma = getLemmaFromExchange(row.exchange);
        if (lemma && lemma !== key) lemmaRow = await lookupKey(lemma);
      } else {
        for (const lemma of fallbackLemmas(key)) {
          row = await lookupKey(lemma);
          if (row) { lemmaRow = row; break; }
        }
      }
      if (!row) {
        showLookupNotFound(word);
        return;
      }
      const display = row.word || word;
      els.lookupWord.textContent = display;
      const phonetic = (row.phonetic || lemmaRow?.phonetic || '').trim();
      els.lookupPhonetic.textContent = phonetic ? `/${phonetic.replace(/^\/+|\/+$/g, '')}/` : '暂无音标';
      els.lookupPos.textContent = row.pos || lemmaRow?.pos || '';
      const translation = (row.translation || lemmaRow?.translation || '').trim();
      els.lookupTranslation.textContent = translation || '词典里有这个词，但没有中文释义。';
      const lemma = getLemmaFromExchange(row.exchange);
      els.lookupHint.textContent = lemma && lemma !== key ? `原形：${lemma}` : '离线释义来自你导入的 ECDICT。';
      state.speakingWord = display;
      els.lookupSheet.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showLookupNotFound(word, '查词时出了点问题。');
    }
  }

  function showLookupLoading(word) {
    els.lookupWord.textContent = word;
    els.lookupPhonetic.textContent = '';
    els.lookupPos.textContent = '';
    els.lookupTranslation.textContent = '正在本机词典里找…';
    els.lookupHint.textContent = '';
    state.speakingWord = word;
    els.lookupSheet.classList.remove('hidden');
  }

  function showLookupMissingDictionary(word) {
    els.lookupTranslation.textContent = '还没有导入离线英汉词典。';
    els.lookupHint.textContent = '回到“离线词典”导入 ecdict.csv 后，就可以断网查中文和音标。';
    els.lookupPhonetic.textContent = '';
    els.lookupPos.textContent = '';
    state.speakingWord = word;
  }

  function showLookupNotFound(word, msg = '本机词典里没有找到这个词。') {
    els.lookupWord.textContent = word;
    els.lookupPhonetic.textContent = '';
    els.lookupPos.textContent = '';
    els.lookupTranslation.textContent = msg;
    els.lookupHint.textContent = '可以仍然点喇叭尝试用系统英语语音朗读。';
    state.speakingWord = word;
    els.lookupSheet.classList.remove('hidden');
  }

  function closeLookup() {
    els.lookupSheet.classList.add('hidden');
    state.lastLookupWord = '';
  }

  function speakCurrentWord() {
    const word = state.speakingWord || state.lastLookupWord;
    if (!word) return;
    if (!('speechSynthesis' in window)) {
      toast('这个浏览器没有系统语音功能');
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.88;
    const voices = speechSynthesis.getVoices();
    const preferred = voices.find(v => /en-US/i.test(v.lang) && v.localService) || voices.find(v => /^en/i.test(v.lang) && v.localService) || voices.find(v => /en-US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
    if (preferred) u.voice = preferred;
    speechSynthesis.speak(u);
  }

  function scheduleSelectionLookup() {
    clearTimeout(state.lookupTimer);
    state.lookupTimer = setTimeout(() => {
      const word = selectedWordFromWindow();
      if (word && word.toLowerCase() !== state.lastLookupWord.toLowerCase()) lookupWord(word);
    }, 420);
  }

  async function updateDictionaryStatus() {
    const info = await getMeta('dictionaryInfo');
    state.dictCount = Number(info?.count) || 0;
    if (state.dictCount) {
      els.dictStatusTitle.textContent = `ECDICT 已就绪 · ${state.dictCount.toLocaleString()} 词条`;
      els.dictStatusDetail.textContent = info?.filename ? `来源：${info.filename} · 仅保存在本机` : '仅保存在本机';
    } else {
      els.dictStatusTitle.textContent = '尚未导入 ECDICT';
      els.dictStatusDetail.textContent = '导入一次后，中文释义和音标可以离线查询。';
    }
  }

  function cleanDictRow(row) {
    const word = String(row.word || '').trim();
    if (!word) return null;
    return {
      key: word.toLowerCase(),
      word,
      phonetic: String(row.phonetic || '').trim(),
      translation: String(row.translation || '').trim(),
      pos: String(row.pos || '').trim(),
      exchange: String(row.exchange || '').trim(),
    };
  }

  async function writeDictionaryBatch(rows) {
    if (!rows.length) return;
    const tx = state.db.transaction(DICT_STORE, 'readwrite');
    const store = tx.objectStore(DICT_STORE);
    for (const row of rows) {
      const clean = cleanDictRow(row);
      if (clean) store.put(clean);
    }
    await txDone(tx);
  }

  async function clearStore(storeName) {
    const tx = state.db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    await txDone(tx);
  }

  async function importDictionary(file) {
    if (!window.Papa) {
      toast('CSV 解析组件还没加载好。第一次打开需要联网完成应用缓存。', 4200);
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      toast('请选择 ecdict.csv');
      return;
    }
    const confirmed = !state.dictCount || confirm('导入新词典会替换当前本机词典。继续吗？');
    if (!confirmed) return;

    els.importProgressWrap.classList.remove('hidden');
    els.importProgressBar.style.width = '1%';
    els.importProgressText.textContent = '清理旧词典…';
    els.clearDictionaryBtn.disabled = true;
    await clearStore(DICT_STORE);
    await setMeta('dictionaryInfo', null);
    state.dictCount = 0;

    let count = 0;
    let processedBytes = 0;
    const started = Date.now();

    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        worker: false,
        chunkSize: 1024 * 1024,
        chunk: (results, parser) => {
          parser.pause();
          const rows = results.data || [];
          const bytesApprox = Math.min(file.size, processedBytes + 1024 * 1024);
          writeDictionaryBatch(rows).then(() => {
            count += rows.length;
            processedBytes = bytesApprox;
            const pct = Math.max(1, Math.min(99, Math.round((processedBytes / file.size) * 100)));
            els.importProgressBar.style.width = `${pct}%`;
            els.importProgressText.textContent = `已导入 ${count.toLocaleString()} 条 · ${pct}%`;
            parser.resume();
          }).catch(err => {
            parser.abort();
            reject(err);
          });
        },
        complete: async () => {
          try {
            const info = { count, filename: file.name, importedAt: Date.now(), elapsedMs: Date.now() - started };
            await setMeta('dictionaryInfo', info);
            await updateDictionaryStatus();
            els.importProgressBar.style.width = '100%';
            els.importProgressText.textContent = `完成：${count.toLocaleString()} 条词条已存到本机。`;
            toast('离线词典导入完成 🐾', 3000);
            resolve();
          } catch (e) { reject(e); }
          finally { els.clearDictionaryBtn.disabled = false; els.dictInput.value = ''; }
        },
        error: err => reject(err),
      });
    }).catch(err => {
      console.error(err);
      els.clearDictionaryBtn.disabled = false;
      els.importProgressText.textContent = `导入失败：${err.message || err}`;
      toast('词典导入失败', 3500);
    });
  }

  async function deleteDictionary() {
    if (!state.dictCount) return;
    if (!confirm('删除这台设备上的离线词典？Word 和阅读进度不会受影响。')) return;
    await clearStore(DICT_STORE);
    await setMeta('dictionaryInfo', null);
    await updateDictionaryStatus();
    els.importProgressWrap.classList.add('hidden');
    toast('本机词典已删除');
  }

  async function clearDocs() {
    const docs = await getAllDocs();
    if (!docs.length) return;
    if (!confirm('清空这台设备上的故事和阅读进度？')) return;
    await clearStore(DOC_STORE);
    await renderLibrary();
    toast('书架已清空');
  }

  function showDictionaryModal() { els.dictionaryModal.classList.remove('hidden'); }
  function hideDictionaryModal() { els.dictionaryModal.classList.add('hidden'); }

  function updateConnectivity() {
    const online = navigator.onLine;
    els.offlineDot.className = `status-dot ${online ? 'warn' : 'ok'}`;
    els.offlineText.textContent = online ? '当前联网 · 阅读和查词可仍然只走本机' : '当前离线 · 本机功能可用';
  }

  async function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('Service worker registration failed', e);
    }
  }

  function bindEvents() {
    els.docxInput.addEventListener('change', e => e.target.files?.[0] && importDocx(e.target.files[0]));
    els.dictInput.addEventListener('change', e => e.target.files?.[0] && importDictionary(e.target.files[0]));
    els.dictionaryBtn.addEventListener('click', showDictionaryModal);
    document.querySelectorAll('[data-close="dictionary"]').forEach(el => el.addEventListener('click', hideDictionaryModal));
    els.clearDictionaryBtn.addEventListener('click', deleteDictionary);
    els.clearDocsBtn.addEventListener('click', clearDocs);
    els.homeBtn.addEventListener('click', async () => {
      await saveProgress();
      setView('library');
      await renderLibrary();
    });
    els.fontMinusBtn.addEventListener('click', () => { state.fontSize = Math.max(16, state.fontSize - 1); saveSettings(); applySettings(); scheduleProgressSave(); });
    els.fontPlusBtn.addEventListener('click', () => { state.fontSize = Math.min(30, state.fontSize + 1); saveSettings(); applySettings(); scheduleProgressSave(); });
    els.themeBtn.addEventListener('click', cycleTheme);
    els.closeLookupBtn.addEventListener('click', closeLookup);
    els.speakBtn.addEventListener('click', speakCurrentWord);

    els.reader.addEventListener('click', e => {
      const strong = e.target.closest('strong');
      if (strong && els.reader.contains(strong)) {
        const word = normalizeSelectedWord(strong.textContent);
        if (word) lookupWord(word);
      }
    });
    document.addEventListener('selectionchange', scheduleSelectionLookup);
    window.addEventListener('scroll', scheduleProgressSave, { passive: true });
    window.addEventListener('resize', updateProgressUI, { passive: true });
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    window.addEventListener('beforeunload', () => { if (state.currentDoc) saveProgress(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.theme === 'system') applySettings(); });
  }

  async function restoreRoute() {
    const m = location.hash.match(/^#read=(.+)$/);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    const doc = await getDoc(id);
    if (doc) await openStoredDoc(id);
  }

  async function init() {
    loadSettings();
    updateConnectivity();
    bindEvents();
    try {
      state.db = await openDB();
      await renderLibrary();
      await updateDictionaryStatus();
      await restoreRoute();
    } catch (err) {
      console.error(err);
      toast('浏览器本机存储初始化失败；请不要使用无痕模式。', 5000);
    }
    await registerSW();
  }

  init();
})();
