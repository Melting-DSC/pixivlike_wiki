/* ==========================================================================
   Content store.

   Loads the default content from content/*.json, overlays a copy saved in
   localStorage, and validates the result. Uploaded images (data: URLs) are
   stored separately in IndexedDB; see "Uploaded images" below.

   No dependencies. Exposes `window.WikiStore`.
   ========================================================================== */

(() => {
  "use strict";

  const STORAGE_KEY = "uchinoko-wiki:content:v1";
  const SAVED_AT_KEY = `${STORAGE_KEY}:savedAt`;
  const FILES = {
    site: "content/site.json",
    article: "content/article.json",
  };

  const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function deepMerge(base, overlay) {
    if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay === undefined ? base : overlay;
    const result = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
      result[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
    }
    return result;
  }

  async function fetchJSON(file) {
    const response = await fetch(file, { cache: "no-store" });
    if (!response.ok) throw new Error(`${file} を読み込めませんでした（HTTP ${response.status}）。`);
    return response.json();
  }

  async function fetchDefaults() {
    const [site, article] = await Promise.all([fetchJSON(FILES.site), fetchJSON(FILES.article)]);
    return { site, article };
  }

  function readSaved() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function hasSaved() {
    return Boolean(readSaved());
  }

  function savedAt() {
    try {
      return window.localStorage.getItem(SAVED_AT_KEY) || "";
    } catch {
      return "";
    }
  }

  async function load() {
    const defaults = await fetchDefaults();
    const saved = readSaved();
    if (!saved) return defaults;
    const state = {
      site: deepMerge(defaults.site, saved.site || {}),
      article: deepMerge(defaults.article, saved.article || {}),
    };
    await restoreImages(state);
    return state;
  }

  function isDataUrl(value) {
    return typeof value === "string" && value.trim().startsWith("data:");
  }

  /* ------------------------------------------------------------------ *
   * Uploaded images
   *
   * localStorage is too small for images, so uploaded images (data: URLs)
   * are kept in IndexedDB. The localStorage copy holds `local-image:<key>`
   * in their place, and load() swaps the image back in. Without IndexedDB
   * the reference is an empty string and the editor asks for the image
   * again on the next visit.
   * ------------------------------------------------------------------ */

  const IMAGE_DB = "uchinoko-wiki:images";
  const IMAGE_STORE = "images";
  const IMAGE_REF = "local-image:";
  let imageDBPromise = null;
  let canStoreImages = typeof window.indexedDB !== "undefined";
  let imageQueue = Promise.resolve();
  const storedImageKeys = new Set();
  const imageKeyCache = new Map();

  const isImageRef = (value) => typeof value === "string" && value.startsWith(IMAGE_REF);

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("画像の保存が中断されました。"));
    });
  }

  function openImageDB() {
    if (!canStoreImages) return Promise.resolve(null);
    imageDBPromise ??= new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(IMAGE_DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(IMAGE_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          canStoreImages = false;
          resolve(null);
        };
      } catch {
        canStoreImages = false;
        resolve(null);
      }
    });
    return imageDBPromise;
  }

  // Content-based key, so the same image is stored once and keeps its key
  // when blocks are reordered.
  function imageKey(dataUrl) {
    const cached = imageKeyCache.get(dataUrl);
    if (cached) return cached;
    let a = 0x811c9dc5;
    let b = 5381;
    for (let index = 0; index < dataUrl.length; index += 1) {
      const code = dataUrl.charCodeAt(index);
      a = Math.imul(a ^ code, 0x01000193);
      b = (Math.imul(b, 33) + code) | 0;
    }
    const key = `img-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}-${dataUrl.length.toString(36)}`;
    imageKeyCache.set(dataUrl, key);
    return key;
  }

  // Every place in the article that can hold an uploaded image.
  function imageHolders(article) {
    const holders = [];
    if (article.hero) holders.push(article.hero);
    for (const section of article.sections || []) {
      for (const block of section.blocks || []) {
        if (block.type === "figure") holders.push(block);
      }
    }
    return holders;
  }

  async function restoreImages(state) {
    const holders = imageHolders(state.article || {}).filter((holder) => isImageRef(holder.src));
    if (!holders.length) return;
    const db = await openImageDB();
    const store = db?.transaction(IMAGE_STORE, "readonly").objectStore(IMAGE_STORE);
    await Promise.all(
      holders.map(async (holder) => {
        const key = holder.src.slice(IMAGE_REF.length);
        let dataUrl = "";
        try {
          dataUrl = store ? (await requestResult(store.get(key))) || "" : "";
        } catch {
          dataUrl = "";
        }
        holder.src = dataUrl;
        if (dataUrl) {
          imageKeyCache.set(dataUrl, key);
          storedImageKeys.add(key);
        }
      }),
    );
  }

  // Writes new images and deletes ones the article no longer uses.
  async function writeImages(images) {
    const db = await openImageDB();
    if (!db) return { ok: false, error: new Error("このブラウザでは画像を保存できません。") };
    const transaction = db.transaction(IMAGE_STORE, "readwrite");
    const store = transaction.objectStore(IMAGE_STORE);
    for (const [key, dataUrl] of images) {
      if (!storedImageKeys.has(key)) store.put(dataUrl, key);
    }
    const existing = await requestResult(store.getAllKeys());
    for (const key of existing) {
      if (!images.has(key)) store.delete(key);
    }
    await transactionDone(transaction);
    storedImageKeys.clear();
    for (const key of images.keys()) storedImageKeys.add(key);
    return { ok: true };
  }

  function persistImages(images) {
    const run = () => writeImages(images).catch((error) => ({ ok: false, error }));
    imageQueue = imageQueue.then(run, run);
    return imageQueue;
  }

  function stripAssets(state) {
    const article = clone(state.article || {});
    const images = new Map();
    for (const holder of imageHolders(article)) {
      if (!isDataUrl(holder.src)) continue;
      if (canStoreImages) {
        const dataUrl = holder.src.trim();
        const key = imageKey(dataUrl);
        images.set(key, dataUrl);
        holder.src = `${IMAGE_REF}${key}`;
      } else {
        holder.src = "";
      }
    }
    return {
      payload: {
        site: clone(state.site || {}),
        article,
      },
      images,
    };
  }

  function countUploadedAssets(state) {
    return imageHolders(state.article || {}).filter((holder) => isDataUrl(holder.src)).length;
  }

  // Uploaded images that will be lost on the next visit.
  function countUnsavedImages(state) {
    return canStoreImages ? 0 : countUploadedAssets(state);
  }

  function save(state) {
    const { payload, images } = stripAssets(state);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      window.localStorage.setItem(SAVED_AT_KEY, new Date().toISOString());
    } catch (error) {
      return { ok: false, error };
    }
    return {
      ok: true,
      savedAt: savedAt(),
      images: canStoreImages ? persistImages(images) : Promise.resolve({ ok: true }),
    };
  }

  function clear() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(SAVED_AT_KEY);
    } catch {
      /* localStorage may be unavailable */
    }
    if (canStoreImages) persistImages(new Map());
  }

  function validate(state) {
    const errors = [];
    const warnings = [];
    const site = state.site || {};
    const article = state.article || {};

    if (!site.site?.name) errors.push("サイト名が設定されていません。");
    if (!article.title) errors.push("記事タイトルが設定されていません。");
    if (!Array.isArray(article.sections)) {
      errors.push("本文のデータが正しい形式ではありません。");
    } else {
      const ids = new Set();
      article.sections.forEach((section, index) => {
        const id = String(section.id || "").trim();
        if (!id) warnings.push(`セクション ${index + 1} にリンク用の名前がありません（section-${index + 1} として扱います）。`);
        if (id && ids.has(id)) errors.push(`セクションのリンク用の名前が重複しています: ${id}`);
        if (id) ids.add(id);
        if (!String(section.title || "").trim()) warnings.push(`セクション ${index + 1} のタイトルが空です。`);
        if (![2, 3].includes(Number(section.level))) {
          warnings.push(`セクション「${section.title || index + 1}」の見出しの大きさは「大見出し」か「小見出し」にしてください。`);
        }
        if (section.blocks !== undefined && !Array.isArray(section.blocks)) {
          errors.push(`セクション「${section.title || index + 1}」の内容が正しい形式ではありません。`);
        }
        if (section.blocks === undefined) {
          warnings.push(`セクション「${section.title || index + 1}」に内容がありません。`);
        }
      });
    }

    if (article.hero && !article.hero.src) {
      warnings.push("メイン画像が設定されていません。編集モードからアップロードするか、画像のURLを入力してください。");
    }

    for (const section of article.sections || []) {
      for (const block of section.blocks || []) {
        if (block.type === "figure" && !block.src) {
          warnings.push(`セクション「${section.title || ""}」に画像が設定されていない画像ブロックがあります。`);
        }
      }
    }

    return { errors, warnings };
  }

  window.WikiStore = {
    STORAGE_KEY,
    FILES,
    load,
    fetchDefaults,
    save,
    clear,
    hasSaved,
    savedAt,
    readSaved,
    stripAssets,
    countUploadedAssets,
    countUnsavedImages,
    validate,
    isDataUrl,
    deepMerge,
  };
})();
