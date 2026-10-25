/* ==========================================================================
   Content store.

   Loads the default content from content/*.json, overlays a copy saved in
   localStorage, and validates the result. Uploaded images are kept only in
   memory: when the state is persisted, data: URLs are replaced with an empty
   string so the editor asks for the image again on the next visit.

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
    return {
      site: deepMerge(defaults.site, saved.site || {}),
      article: deepMerge(defaults.article, saved.article || {}),
    };
  }

  function isDataUrl(value) {
    return typeof value === "string" && value.trim().startsWith("data:");
  }

  function stripAssets(state) {
    const article = clone(state.article || {});
    if (article.hero && isDataUrl(article.hero.src)) article.hero.src = "";
    for (const section of article.sections || []) {
      for (const block of section.blocks || []) {
        if (block.type === "figure" && isDataUrl(block.src)) block.src = "";
      }
    }
    return {
      site: clone(state.site || {}),
      article,
    };
  }

  function countUploadedAssets(state) {
    const article = state.article || {};
    let count = 0;
    if (isDataUrl(article.hero?.src)) count += 1;
    for (const section of article.sections || []) {
      for (const block of section.blocks || []) {
        if (block.type === "figure" && isDataUrl(block.src)) count += 1;
      }
    }
    return count;
  }

  function save(state) {
    const payload = stripAssets(state);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      window.localStorage.setItem(SAVED_AT_KEY, new Date().toISOString());
      return { ok: true, savedAt: savedAt() };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function clear() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(SAVED_AT_KEY);
    } catch {
      /* localStorage may be unavailable */
    }
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
    validate,
    isDataUrl,
    deepMerge,
  };
})();
