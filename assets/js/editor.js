/* ==========================================================================
   Content editor for the parody encyclopedia.
   Loads content/*.json, provides structural forms, and (when served by
   scripts/serve.mjs) saves + rebuilds the site through /api/save.
   ========================================================================== */

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const app = $("#editor-app");
  const loading = $("#editor-loading");
  const errorBox = $("#editor-error");
  const errorMessage = $("#editor-error-message");
  const statusEl = $("#editor-status");
  const statusText = $("#editor-status-text");
  const toastEl = $("#editor-toast");
  const savebar = $("#editor-savebar");
  const savebarText = $("#editor-savebar-text");
  const heroPreview = $("#hero-preview img");
  const jsonArea = $("#json-area");
  const jsonFile = $("#json-file");
  const jsonFileTag = $("#json-file-tag");
  const importInputs = [$("#import-files"), $("#import-files-error")].filter(Boolean);

  const state = { site: null, article: null, categories: null };
  const PANELS = ["basic", "body", "categories", "site", "json"];
  const BLOCK_TYPES = [
    ["paragraph", "段落"],
    ["list", "リスト"],
    ["code", "コード"],
    ["callout", "注記ボックス"],
    ["figure", "画像"],
    ["tags", "タグ"],
    ["quote", "引用"],
    ["divider", "区切り線"],
  ];
  const BLOCK_LABELS = Object.fromEntries(BLOCK_TYPES);
  const CATEGORY_COLORS = ["#5b7c99", "#2f7fbf", "#2f8f83", "#a1762a", "#b25b7a", "#8055c7", "#4f7a3a"];

  let activePanel = "basic";
  let dirty = false;
  let saving = false;
  let jsonKey = "site";
  let toastTimer = 0;
  let loaded = false;

  /* ======================================================================== *
   * Small utilities
   * ======================================================================== */

  const esc = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const attr = esc;

  const getPath = (object, path) =>
    String(path)
      .split(".")
      .reduce((value, key) => (value == null ? undefined : value[key]), object);

  function setPath(object, path, value) {
    const keys = String(path).split(".");
    const last = keys.pop();
    let target = object;
    for (const key of keys) {
      if (target[key] == null || typeof target[key] !== "object") target[key] = {};
      target = target[key];
    }
    target[last] = value;
  }

  const today = () => new Date().toISOString().slice(0, 10);

  function uniqueId(base, used = []) {
    const set = new Set(used);
    let index = 1;
    let candidate = `${base}-${index}`;
    while (set.has(candidate)) {
      index += 1;
      candidate = `${base}-${index}`;
    }
    return candidate;
  }

  function uniqueKey(base, object = {}) {
    if (!Object.hasOwn(object, base)) return base;
    let index = 2;
    while (Object.hasOwn(object, `${base}${index}`)) index += 1;
    return `${base}${index}`;
  }

  function setStatus(kind, text) {
    if (!statusEl) return;
    statusEl.dataset.state = kind;
    if (statusText) statusText.textContent = text;
  }

  function showToast(message, tone = "info", duration = 3600) {
    if (!toastEl) return;
    window.clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.dataset.tone = tone;
    toastEl.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toastEl.classList.remove("is-visible"), duration);
  }

  function markDirty() {
    if (!loaded) return;
    dirty = true;
    if (!saving) setStatus("dirty", "未保存の変更");
    updateSavebar();
  }

  function updateSavebar() {
    if (!savebar) return;
    savebar.hidden = !dirty && !saving;
    if (savebarText) {
      savebarText.textContent = saving ? "保存してビルドしています…" : "未保存の変更があります";
    }
  }

  function selected(value, current) {
    return String(value) === String(current) ? " selected" : "";
  }

  function checked(value) {
    return value ? " checked" : "";
  }

  function emptyState(message) {
    return `<p class="empty-state">${esc(message)}</p>`;
  }

  /* ======================================================================== *
   * Loading / showing / error
   * ======================================================================== */

  async function fetchJSON(file) {
    const response = await fetch(`content/${file}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`content/${file} を読み込めませんでした（HTTP ${response.status}）。`);
    return response.json();
  }

  async function loadAll() {
    setStatus("loading", "読み込み中…");
    loading.hidden = false;
    errorBox.hidden = true;
    app.hidden = true;

    const [site, article, categories] = await Promise.all([
      fetchJSON("site.json"),
      fetchJSON("article.json"),
      fetchJSON("categories.json"),
    ]);

    state.site = site;
    state.article = article;
    state.categories = categories;
    loaded = true;
    showEditor();
  }

  function showEditor() {
    loading.hidden = true;
    errorBox.hidden = true;
    app.hidden = false;
    fillStaticFields();
    renderAll();
    syncJsonArea();
    setPanel(activePanel, false);
    dirty = false;
    setStatus("saved", "保存済み");
    updateSavebar();
  }

  function showError(error) {
    loaded = false;
    loading.hidden = true;
    app.hidden = true;
    errorBox.hidden = false;

    const isFile = window.location.protocol === "file:";
    const base = isFile
      ? "file:// で直接開くと、ブラウザのセキュリティ制限で content/*.json を読み込めません。"
      : "JSONの読み込み中にエラーが発生しました。";
    const detail = error?.message ? `（${error.message}）` : "";
    errorMessage.textContent = `${base}${detail} ローカルサーバーを起動するか、下のファイル選択から3つのJSONを読み込んでください。`;
    setStatus("error", "読み込みエラー");
  }

  function fillStaticFields() {
    for (const field of $$("[data-path]")) {
      const path = field.dataset.path;
      const value = getPath(state, path);

      if (field.type === "checkbox") {
        field.checked = Boolean(value);
      } else if (field.dataset.transform === "csv") {
        field.value = Array.isArray(value) ? value.join("、") : value ?? "";
      } else {
        field.value = value ?? "";
      }
    }
    updateHeroPreview();
    updateStats();
  }

  function updateHeroPreview() {
    if (!heroPreview) return;
    const src = state.article?.hero?.src || "assets/images/c-language.svg";
    if (heroPreview.getAttribute("src") !== src) heroPreview.setAttribute("src", src);
    heroPreview.alt = state.article?.hero?.alt || "";
  }

  /* ======================================================================== *
   * Main renderers
   * ======================================================================== */

  function renderAll() {
    renderBreadcrumbs();
    renderActions();
    renderLinkTerms();
    renderHistory();
    renderSections();
    renderCategoryGroups();
    renderSpotlight();
    renderFooterColumns();
    renderMenuSections();
    updateStats();
    updateHeroPreview();
  }

  function updateStats() {
    const sections = state.article?.sections ?? [];
    const blocks = sections.reduce((sum, section) => sum + (section.blocks?.length || 0), 0);
    const groups = state.categories?.groups ?? [];
    const items = groups.reduce((sum, group) => sum + (group.items?.length || 0), 0);
    const tags = state.article?.relatedTags?.length ?? 0;

    const setText = (selector, value) => {
      const element = $(selector);
      if (element) element.textContent = value;
    };

    setText("#stat-sections", sections.length);
    setText("#stat-blocks", blocks);
    setText("#stat-categories", groups.length);
    setText("#stat-items", items);
    setText("#stat-tags", tags);
    setText("#section-count-label", sections.length);
    setText("#category-count-label", groups.length);

    for (const node of $$('[data-count="sections"]')) node.textContent = sections.length;
    for (const node of $$('[data-count="blocks"]')) node.textContent = blocks;
    for (const node of $$('[data-count="items"]')) node.textContent = items;
  }

  /* ---------------------------- breadcrumb ------------------------------ */

  function renderBreadcrumbs() {
    const container = $("#breadcrumb-rows");
    if (!container) return;
    const rows = state.article?.breadcrumb ?? [];
    container.innerHTML = rows.length
      ? rows
          .map(
            (row, index) => `<div class="repeat-row">
  <input type="text" data-path="article.breadcrumb.${index}.label" value="${attr(row.label)}" placeholder="階層名" aria-label="パンくず ${index + 1} の名前">
  <input type="text" data-path="article.breadcrumb.${index}.href" value="${attr(row.href)}" placeholder="#categories" aria-label="パンくず ${index + 1} のリンク先">
  <button type="button" class="row-icon-button" data-remove-array="article.breadcrumb" data-index="${index}" aria-label="この階層を削除">×</button>
</div>`,
          )
          .join("")
      : emptyState("パンくずはまだありません。「＋ 追加」から作成できます。");
  }

  function renderActions() {
    const container = $("#action-rows");
    if (!container) return;
    const rows = state.article?.actions ?? [];
    container.innerHTML = rows.length
      ? rows
          .map(
            (row, index) => `<div class="repeat-row repeat-row--action">
  <input type="text" data-path="article.actions.${index}.label" value="${attr(row.label)}" placeholder="リンク名" aria-label="リンク ${index + 1} の名前">
  <input type="text" data-path="article.actions.${index}.href" value="${attr(row.href)}" placeholder="#top" aria-label="リンク ${index + 1} のリンク先">
  <label class="repeat-row__check"><input type="checkbox" data-path="article.actions.${index}.primary"${checked(row.primary)}>太字</label>
  <button type="button" class="row-icon-button" data-remove-array="article.actions" data-index="${index}" aria-label="このリンクを削除">×</button>
</div>`,
          )
          .join("")
      : emptyState("ヘッダーリンクはまだありません。");
  }

  function renderHistory() {
    const container = $("#history-rows");
    if (!container) return;
    const rows = state.article?.history ?? [];
    container.innerHTML = rows.length
      ? rows
          .map(
            (row, index) => `<div class="repeat-row repeat-row--history">
  <input type="date" data-path="article.history.${index}.date" value="${attr(row.date)}" aria-label="更新日">
  <input type="text" data-path="article.history.${index}.note" value="${attr(row.note)}" placeholder="更新内容" aria-label="更新内容">
  <button type="button" class="row-icon-button" data-remove-array="article.history" data-index="${index}" aria-label="この履歴を削除">×</button>
</div>`,
          )
          .join("")
      : emptyState("編集履歴はまだありません。");
  }

  /* ---------------------------- link terms ------------------------------ */

  function renderLinkTerms() {
    const container = $("#linkterm-rows");
    if (!container) return;
    const terms = Object.entries(state.article?.linkTerms ?? {});
    container.innerHTML = terms.length
      ? terms
          .map(
            ([term, href]) => `<div class="repeat-row repeat-row--linkterm">
  <input type="text" data-term-key="${attr(term)}" value="${attr(term)}" placeholder="語句" aria-label="リンク語句">
  <input type="text" data-term-href="${attr(term)}" value="${attr(href)}" placeholder="#top または https://…" aria-label="リンク先">
  <button type="button" class="row-icon-button" data-remove-term="${attr(term)}" aria-label="この語句を削除">×</button>
</div>`,
          )
          .join("")
      : emptyState("リンク語句はまだありません。");
  }

  /* ----------------------------- sections ------------------------------- */

  const blockTypeOptions = (current) =>
    BLOCK_TYPES.map(([value, label]) => `<option value="${value}"${selected(value, current)}>${label}</option>`).join("");

  function renderSections() {
    const container = $("#sections");
    if (!container) return;
    const sections = state.article?.sections ?? [];

    container.innerHTML = sections.length
      ? sections
          .map((section, sectionIndex) => {
            const blocks = section.blocks ?? [];
            const blockHTML = blocks.length
              ? blocks.map((block, blockIndex) => blockEditorHTML(block, sectionIndex, blockIndex)).join("")
              : emptyState("この節にはまだブロックがありません。");

            return `<article class="section-editor" data-section="${sectionIndex}">
  <header class="section-editor__head">
    <span class="section-editor__index">${sectionIndex + 1}</span>
    <input class="section-editor__title-input" type="text" data-path="article.sections.${sectionIndex}.title" value="${attr(section.title)}" placeholder="節タイトル" aria-label="節 ${sectionIndex + 1} のタイトル">
    <select data-path="article.sections.${sectionIndex}.level" data-type="number" aria-label="見出しレベル">
      <option value="2"${selected(2, section.level)}>見出し2（大）</option>
      <option value="3"${selected(3, section.level)}>見出し3（小）</option>
    </select>
    <div class="section-editor__controls">
      <button type="button" class="row-icon-button" data-move-section="${sectionIndex}" data-delta="-1" aria-label="上へ移動"${sectionIndex === 0 ? " disabled" : ""}>↑</button>
      <button type="button" class="row-icon-button" data-move-section="${sectionIndex}" data-delta="1" aria-label="下へ移動"${sectionIndex === sections.length - 1 ? " disabled" : ""}>↓</button>
      <button type="button" class="row-icon-button" data-remove-section="${sectionIndex}" aria-label="この節を削除">×</button>
    </div>
  </header>
  <div class="section-editor__meta">
    <label class="field">
      <span class="field__label">ID（アンカー）</span>
      <input type="text" data-path="article.sections.${sectionIndex}.id" value="${attr(section.id)}" placeholder="section-${sectionIndex + 1}" aria-label="節 ${sectionIndex + 1} のID">
    </label>
    <p>英数字とハイフン推奨。目次・検索結果・本文内リンクの <code>#${esc(section.id || `section-${sectionIndex + 1}`)}</code> に使われます。</p>
  </div>
  <div class="block-list">${blockHTML}</div>
  <footer class="section-editor__foot">
    <div class="block-add">
      <select data-add-block-type="${sectionIndex}" aria-label="追加するブロックの種類">${blockTypeOptions("paragraph")}</select>
      <button type="button" class="editor-mini-button" data-add-block="${sectionIndex}">＋ ブロックを追加</button>
    </div>
    <button type="button" class="editor-mini-button editor-mini-button--danger" data-remove-section="${sectionIndex}">この節を削除</button>
  </footer>
</article>`;
          })
          .join("")
      : emptyState("節はまだありません。「＋ 節を追加」から始めてください。");

    updateStats();
  }

  function blockEditorHTML(block, sectionIndex, blockIndex) {
    const path = `article.sections.${sectionIndex}.blocks.${blockIndex}`;
    const type = BLOCK_LABELS[block.type] ? block.type : "paragraph";
    const blocks = state.article.sections[sectionIndex].blocks;

    return `<div class="block-editor" data-block="${sectionIndex}:${blockIndex}">
  <div class="block-editor__bar">
    <span class="block-editor__type">${esc(BLOCK_LABELS[block.type] || block.type)}</span>
    <select data-block-type="${sectionIndex}:${blockIndex}" aria-label="ブロックの種類">${blockTypeOptions(block.type)}</select>
    <div class="row-controls">
      <button type="button" class="row-icon-button" data-move-block="${sectionIndex}:${blockIndex}" data-delta="-1" aria-label="上へ移動"${blockIndex === 0 ? " disabled" : ""}>↑</button>
      <button type="button" class="row-icon-button" data-move-block="${sectionIndex}:${blockIndex}" data-delta="1" aria-label="下へ移動"${blockIndex === blocks.length - 1 ? " disabled" : ""}>↓</button>
      <button type="button" class="row-icon-button" data-remove-block="${sectionIndex}:${blockIndex}" aria-label="このブロックを削除">×</button>
    </div>
  </div>
  <div class="block-fields">${blockFieldsHTML(block, path)}</div>
</div>`;
  }

  function blockFieldsHTML(block, path) {
    switch (block.type) {
      case "paragraph":
        return `<label class="field field--full">
  <span class="field__label">本文</span>
  <textarea rows="3" data-path="${path}.text" placeholder="段落の文章">${esc(block.text || "")}</textarea>
  <span class="field__hint"><code>[[語句]]</code> / <code>**強調**</code> / <code>\`コード\`</code> / <code>[表示名](URL)</code> が使えます。</span>
</label>`;

      case "list":
        return `<div class="field-grid">
  <label class="field">
    <span class="field__label">リスト見出し（任意）</span>
    <input type="text" data-path="${path}.title" value="${attr(block.title || "")}" placeholder="C言語あるある">
  </label>
  <label class="field field--check">
    <input type="checkbox" data-path="${path}.ordered"${checked(block.ordered)}>
    <span>番号付きリスト</span>
  </label>
  <label class="field field--full">
    <span class="field__label">項目（1行に1つ）</span>
    <textarea rows="5" data-path="${path}.items" data-transform="lines" placeholder="項目1&#10;項目2">${esc((block.items || []).join("\n"))}</textarea>
  </label>
</div>`;

      case "code":
        return `<div class="field-grid">
  <label class="field">
    <span class="field__label">ファイル名</span>
    <input type="text" data-path="${path}.filename" value="${attr(block.filename || "")}" placeholder="hello.c">
  </label>
  <label class="field">
    <span class="field__label">言語</span>
    <input type="text" data-path="${path}.language" value="${attr(block.language || "")}" placeholder="c">
  </label>
  <label class="field field--full">
    <span class="field__label">コード</span>
    <textarea class="code-textarea" rows="8" data-path="${path}.code" spellcheck="false">${esc(block.code || "")}</textarea>
  </label>
</div>`;

      case "callout":
        return `<div class="field-grid">
  <label class="field">
    <span class="field__label">種類</span>
    <select data-path="${path}.tone">
      <option value="info"${selected("info", block.tone)}>情報（青）</option>
      <option value="warn"${selected("warn", block.tone)}>注意（黄）</option>
      <option value="parody"${selected("parody", block.tone)}>パロディ（紫）</option>
    </select>
  </label>
  <label class="field">
    <span class="field__label">見出し（任意）</span>
    <input type="text" data-path="${path}.title" value="${attr(block.title || "")}" placeholder="このページについて">
  </label>
  <label class="field field--full">
    <span class="field__label">本文</span>
    <textarea rows="2" data-path="${path}.text">${esc(block.text || "")}</textarea>
  </label>
</div>`;

      case "figure":
        return `<div class="field-grid">
  <label class="field field--full">
    <span class="field__label">画像パス</span>
    <input type="text" data-path="${path}.src" value="${attr(block.src || "")}" placeholder="assets/images/pointer-map.svg">
  </label>
  <label class="field field--full">
    <span class="field__label">代替テキスト</span>
    <input type="text" data-path="${path}.alt" value="${attr(block.alt || "")}">
  </label>
  <label class="field">
    <span class="field__label">キャプション</span>
    <input type="text" data-path="${path}.caption" value="${attr(block.caption || "")}">
  </label>
  <label class="field">
    <span class="field__label">クレジット</span>
    <input type="text" data-path="${path}.credit" value="${attr(block.credit || "")}">
  </label>
</div>`;

      case "tags":
        return `<label class="field field--full">
  <span class="field__label">タグ（1行に1つ）</span>
  <textarea rows="4" data-path="${path}.items" data-transform="lines" placeholder="プログラミング言語&#10;ポインタ">${esc((block.items || []).join("\n"))}</textarea>
  <span class="field__hint">本文中のタグボタンになります。検索インデックスにも追加されます。</span>
</label>`;

      case "quote":
        return `<div class="field-grid">
  <label class="field field--full">
    <span class="field__label">引用文</span>
    <textarea rows="3" data-path="${path}.text">${esc(block.text || "")}</textarea>
  </label>
  <label class="field field--full">
    <span class="field__label">出典（任意）</span>
    <input type="text" data-path="${path}.cite" value="${attr(block.cite || "")}">
  </label>
</div>`;

      case "divider":
        return `<p class="block-editor__empty">区切り線を表示します。設定はありません。</p>`;

      default:
        return `<p class="block-editor__empty">未対応のブロック種別「${esc(block.type)}」です。種別を変更してください。</p>`;
    }
  }

  function defaultBlock(type) {
    switch (type) {
      case "list":
        return { type: "list", title: "", ordered: false, items: [""] };
      case "code":
        return { type: "code", filename: "snippet.c", language: "c", code: "" };
      case "callout":
        return { type: "callout", tone: "info", title: "", text: "" };
      case "figure":
        return { type: "figure", src: "", alt: "", caption: "", credit: "" };
      case "tags":
        return { type: "tags", items: [] };
      case "quote":
        return { type: "quote", text: "", cite: "" };
      case "divider":
        return { type: "divider" };
      case "paragraph":
      default:
        return { type: "paragraph", text: "" };
    }
  }

  function convertBlock(block, type) {
    const next = defaultBlock(type);
    for (const key of Object.keys(next)) {
      if (key !== "type" && block[key] !== undefined) next[key] = block[key];
    }
    return next;
  }

  /* ---------------------------- categories ------------------------------ */

  function renderCategoryGroups() {
    const container = $("#category-groups");
    if (!container) return;
    const groups = state.categories?.groups ?? [];

    container.innerHTML = groups.length
      ? groups
          .map((group, groupIndex) => {
            const items = group.items ?? [];
            const itemRows = items.length
              ? items
                  .map(
                    (item, itemIndex) => `<div class="repeat-row repeat-row--item">
  <input type="text" data-path="categories.groups.${groupIndex}.items.${itemIndex}.name" value="${attr(item.name)}" placeholder="項目名" aria-label="項目名">
  <input type="text" data-path="categories.groups.${groupIndex}.items.${itemIndex}.href" value="${attr(item.href || "")}" placeholder="#top" aria-label="リンク先">
  <label class="repeat-row__check"><input type="checkbox" data-path="categories.groups.${groupIndex}.items.${itemIndex}.current" data-flag="current"${checked(item.current)}>この記事</label>
  <label class="repeat-row__check"><input type="checkbox" data-path="categories.groups.${groupIndex}.items.${itemIndex}.soon" data-flag="soon"${checked(item.soon)}>未作成</label>
  <button type="button" class="row-icon-button" data-remove-array="categories.groups.${groupIndex}.items" data-index="${itemIndex}" aria-label="この項目を削除">×</button>
</div>`,
                  )
                  .join("")
              : emptyState("項目はまだありません。");

            return `<article class="category-editor" data-group="${groupIndex}" style="--category-color:${attr(group.color || "#5b7c99")}">
  <header class="category-editor__head">
    <span class="category-editor__dot" aria-hidden="true"></span>
    <input type="text" data-path="categories.groups.${groupIndex}.name" value="${attr(group.name)}" placeholder="カテゴリ名" aria-label="カテゴリ ${groupIndex + 1} の名前">
    <input type="color" data-path="categories.groups.${groupIndex}.color" value="${attr(group.color || "#5b7c99")}" aria-label="カテゴリカラー" title="カテゴリカラー">
    <div class="row-controls">
      <button type="button" class="row-icon-button" data-move-group="${groupIndex}" data-delta="-1" aria-label="上へ移動"${groupIndex === 0 ? " disabled" : ""}>↑</button>
      <button type="button" class="row-icon-button" data-move-group="${groupIndex}" data-delta="1" aria-label="下へ移動"${groupIndex === groups.length - 1 ? " disabled" : ""}>↓</button>
      <button type="button" class="row-icon-button" data-remove-group="${groupIndex}" aria-label="このカテゴリを削除">×</button>
    </div>
  </header>
  <div class="category-editor__body">
    <div class="category-editor__meta">
      <label class="field">
        <span class="field__label">ID（アンカー）</span>
        <input type="text" data-path="categories.groups.${groupIndex}.id" value="${attr(group.id)}" placeholder="category-${groupIndex + 1}">
      </label>
      <label class="field">
        <span class="field__label">色</span>
        <input type="text" data-path="categories.groups.${groupIndex}.color" value="${attr(group.color || "")}" placeholder="#5b7c99">
      </label>
      <label class="field">
        <span class="field__label">説明</span>
        <input type="text" data-path="categories.groups.${groupIndex}.description" value="${attr(group.description || "")}" placeholder="カテゴリの短い説明">
      </label>
    </div>
    <div class="category-editor__items-head">
      <span>項目 ${items.length} 件</span>
      <button type="button" class="editor-mini-button" data-add-cat-item="${groupIndex}">＋ 項目を追加</button>
    </div>
    <div class="repeat-list">${itemRows}</div>
  </div>
</article>`;
          })
          .join("")
      : emptyState("カテゴリはまだありません。「＋ カテゴリを追加」から作成できます。");

    updateStats();
  }

  /* ----------------------------- spotlight ------------------------------ */

  function renderSpotlight() {
    const container = $("#spotlight-rows");
    if (!container) return;
    const rows = state.site?.spotlight?.items ?? [];

    container.innerHTML = rows.length
      ? rows
          .map(
            (row, index) => `<div class="repeat-row repeat-row--spotlight">
  <input type="text" data-path="site.spotlight.items.${index}.label" value="${attr(row.label)}" placeholder="表示名" aria-label="注目リンク ${index + 1} の表示名">
  <input type="text" data-path="site.spotlight.items.${index}.query" value="${attr(row.query || "")}" placeholder="検索語（任意）" aria-label="検索語">
  <input type="text" data-path="site.spotlight.items.${index}.href" value="${attr(row.href || "")}" placeholder="リンク先（任意）" aria-label="リンク先">
  <button type="button" class="row-icon-button" data-remove-array="site.spotlight.items" data-index="${index}" aria-label="この注目リンクを削除">×</button>
</div>`,
          )
          .join("")
      : emptyState("注目リンクはまだありません。");
  }

  /* --------------------------- footer / menu ---------------------------- */

  function renderFooterColumns() {
    const container = $("#footer-columns");
    if (!container) return;
    const columns = state.site?.footer?.columns ?? [];

    container.innerHTML = columns.length
      ? columns
          .map((column, columnIndex) => {
            const links = column.links ?? [];
            const linkRows = links.length
              ? links
                  .map(
                    (link, linkIndex) => `<div class="repeat-row repeat-row--footer-link">
  <input type="text" data-path="site.footer.columns.${columnIndex}.links.${linkIndex}.label" value="${attr(link.label)}" placeholder="リンク名" aria-label="リンク名">
  <input type="text" data-path="site.footer.columns.${columnIndex}.links.${linkIndex}.href" value="${attr(link.href || "")}" placeholder="#top" aria-label="リンク先">
  <select data-path="site.footer.columns.${columnIndex}.links.${linkIndex}.action" aria-label="特殊アクション">
    <option value=""${selected("", link.action)}>通常リンク</option>
    <option value="history"${selected("history", link.action)}>編集履歴を開く</option>
    <option value="soon"${selected("soon", link.action)}>準備中トースト</option>
  </select>
  <button type="button" class="row-icon-button" data-remove-array="site.footer.columns.${columnIndex}.links" data-index="${linkIndex}" aria-label="このリンクを削除">×</button>
</div>`,
                  )
                  .join("")
              : emptyState("リンクはまだありません。");

            return `<div class="nested-group">
  <div class="nested-group__head">
    <input type="text" data-path="site.footer.columns.${columnIndex}.title" value="${attr(column.title)}" placeholder="列タイトル" aria-label="フッター列のタイトル">
    <div class="row-controls">
      <button type="button" class="row-icon-button" data-move-array="site.footer.columns" data-index="${columnIndex}" data-delta="-1" aria-label="上へ移動"${columnIndex === 0 ? " disabled" : ""}>↑</button>
      <button type="button" class="row-icon-button" data-move-array="site.footer.columns" data-index="${columnIndex}" data-delta="1" aria-label="下へ移動"${columnIndex === columns.length - 1 ? " disabled" : ""}>↓</button>
      <button type="button" class="row-icon-button" data-remove-array="site.footer.columns" data-index="${columnIndex}" aria-label="この列を削除">×</button>
    </div>
  </div>
  <div class="nested-links">${linkRows}</div>
  <button type="button" class="editor-mini-button nested-add" data-add-footer-link="${columnIndex}">＋ リンクを追加</button>
</div>`;
          })
          .join("")
      : emptyState("フッター列はまだありません。");
  }

  function renderMenuSections() {
    const container = $("#menu-sections");
    if (!container) return;
    const sections = state.site?.menu?.sections ?? [];

    container.innerHTML = sections.length
      ? sections
          .map((section, sectionIndex) => {
            const links = section.links ?? [];
            const linkRows = links.length
              ? links
                  .map(
                    (link, linkIndex) => `<div class="repeat-row repeat-row--menu-link">
  <input type="text" data-path="site.menu.sections.${sectionIndex}.links.${linkIndex}.label" value="${attr(link.label)}" placeholder="リンク名" aria-label="リンク名">
  <input type="text" data-path="site.menu.sections.${sectionIndex}.links.${linkIndex}.href" value="${attr(link.href || "")}" placeholder="#top" aria-label="リンク先">
  <button type="button" class="row-icon-button" data-remove-array="site.menu.sections.${sectionIndex}.links" data-index="${linkIndex}" aria-label="このリンクを削除">×</button>
</div>`,
                  )
                  .join("")
              : emptyState("リンクはまだありません。");

            return `<div class="nested-group">
  <div class="nested-group__head">
    <input type="text" data-path="site.menu.sections.${sectionIndex}.title" value="${attr(section.title)}" placeholder="セクション名" aria-label="メニューセクション名">
    <div class="row-controls">
      <button type="button" class="row-icon-button" data-move-array="site.menu.sections" data-index="${sectionIndex}" data-delta="-1" aria-label="上へ移動"${sectionIndex === 0 ? " disabled" : ""}>↑</button>
      <button type="button" class="row-icon-button" data-move-array="site.menu.sections" data-index="${sectionIndex}" data-delta="1" aria-label="下へ移動"${sectionIndex === sections.length - 1 ? " disabled" : ""}>↓</button>
      <button type="button" class="row-icon-button" data-remove-array="site.menu.sections" data-index="${sectionIndex}" aria-label="このセクションを削除">×</button>
    </div>
  </div>
  <div class="nested-links">${linkRows}</div>
  <button type="button" class="editor-mini-button nested-add" data-add-menu-link="${sectionIndex}">＋ リンクを追加</button>
</div>`;
          })
          .join("")
      : emptyState("メニューセクションはまだありません。");
  }

  /* ======================================================================== *
   * Structural operations
   * ======================================================================== */

  function renderForPath(path = "") {
    if (path.startsWith("article.breadcrumb")) return renderBreadcrumbs();
    if (path.startsWith("article.actions")) return renderActions();
    if (path.startsWith("article.history")) return renderHistory();
    if (path.startsWith("article.sections")) return renderSections();
    if (path.startsWith("categories.groups")) return renderCategoryGroups();
    if (path.startsWith("site.spotlight")) return renderSpotlight();
    if (path.startsWith("site.footer.columns")) return renderFooterColumns();
    if (path.startsWith("site.menu.sections")) return renderMenuSections();
    return renderAll();
  }

  function confirmRemove(message) {
    return window.confirm(`${message}\n\nこの操作は「保存」するまでファイルに反映されません。`);
  }

  function addSimple(kind, anchor) {
    if (!state.article || !state.site) return;

    switch (kind) {
      case "breadcrumb":
        state.article.breadcrumb ??= [];
        state.article.breadcrumb.push({ label: "新しい階層", href: "#categories" });
        renderBreadcrumbs();
        break;
      case "action":
        state.article.actions ??= [];
        state.article.actions.push({ label: "新しいリンク", href: "#top" });
        renderActions();
        break;
      case "linkterm": {
        state.article.linkTerms ??= {};
        const key = uniqueKey("新しい語句", state.article.linkTerms);
        state.article.linkTerms[key] = "#top";
        renderLinkTerms();
        break;
      }
      case "history":
        state.article.history ??= [];
        state.article.history.unshift({ date: today(), note: "更新内容" });
        renderHistory();
        break;
      case "spotlight":
        state.site.spotlight ??= { label: "注目", items: [] };
        state.site.spotlight.items ??= [];
        state.site.spotlight.items.push({ label: "新しい注目", query: "C言語" });
        renderSpotlight();
        break;
      case "footer-column":
        state.site.footer.columns ??= [];
        state.site.footer.columns.push({ title: "新しい列", links: [{ label: "リンク", href: "#top" }] });
        renderFooterColumns();
        break;
      case "menu-section":
        state.site.menu.sections ??= [];
        state.site.menu.sections.push({ title: "新しいセクション", links: [{ label: "リンク", href: "#top" }] });
        renderMenuSections();
        break;
      default:
        return;
    }

    markDirty();
    anchor?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function addSection() {
    const sections = state.article.sections;
    const id = uniqueId("section", sections.map((section) => section.id));
    sections.push({
      id,
      level: 2,
      title: "新しい節",
      blocks: [{ type: "paragraph", text: "" }],
    });
    renderSections();
    markDirty();

    const editor = $(`.section-editor[data-section="${sections.length - 1}"]`);
    editor?.scrollIntoView({ behavior: "smooth", block: "start" });
    editor?.querySelector(".section-editor__title-input")?.focus({ preventScroll: true });
  }

  function removeSection(index) {
    if (!confirmRemove("この節と中のブロックを削除しますか？")) return;
    state.article.sections.splice(index, 1);
    renderSections();
    markDirty();
  }

  function moveSection(index, delta) {
    const sections = state.article.sections;
    const target = index + Number(delta);
    if (target < 0 || target >= sections.length) return;
    [sections[index], sections[target]] = [sections[target], sections[index]];
    renderSections();
    markDirty();
  }

  function addBlock(sectionIndex) {
    const select = $(`[data-add-block-type="${sectionIndex}"]`);
    const type = select?.value || "paragraph";
    const section = state.article.sections[sectionIndex];
    section.blocks ??= [];
    section.blocks.push(defaultBlock(type));
    renderSections();
    markDirty();

    const blockIndex = section.blocks.length - 1;
    const block = $(`.block-editor[data-block="${sectionIndex}:${blockIndex}"]`);
    block?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function removeBlock(sectionIndex, blockIndex) {
    if (!confirmRemove("このブロックを削除しますか？")) return;
    state.article.sections[sectionIndex].blocks.splice(blockIndex, 1);
    renderSections();
    markDirty();
  }

  function moveBlock(sectionIndex, blockIndex, delta) {
    const blocks = state.article.sections[sectionIndex].blocks;
    const target = blockIndex + Number(delta);
    if (target < 0 || target >= blocks.length) return;
    [blocks[blockIndex], blocks[target]] = [blocks[target], blocks[blockIndex]];
    renderSections();
    markDirty();
  }

  function changeBlockType(sectionIndex, blockIndex, type) {
    const blocks = state.article.sections[sectionIndex].blocks;
    const current = blocks[blockIndex];
    if (!current || current.type === type) return;
    blocks[blockIndex] = convertBlock(current, type);
    renderSections();
    markDirty();
  }

  function addGroup() {
    const groups = state.categories.groups;
    const id = uniqueId("category", groups.map((group) => group.id));
    groups.push({
      id,
      name: "新しいカテゴリ",
      color: CATEGORY_COLORS[groups.length % CATEGORY_COLORS.length],
      description: "",
      items: [],
    });
    renderCategoryGroups();
    markDirty();

    const editor = $(".category-editor:last-of-type");
    editor?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function removeGroup(index) {
    if (!confirmRemove("このカテゴリと収録項目を削除しますか？")) return;
    state.categories.groups.splice(index, 1);
    renderCategoryGroups();
    markDirty();
  }

  function moveGroup(index, delta) {
    const groups = state.categories.groups;
    const target = index + Number(delta);
    if (target < 0 || target >= groups.length) return;
    [groups[index], groups[target]] = [groups[target], groups[index]];
    renderCategoryGroups();
    markDirty();
  }

  function addCategoryItem(groupIndex) {
    const group = state.categories.groups[groupIndex];
    group.items ??= [];
    group.items.push({ name: "新しい項目", href: "#top" });
    renderCategoryGroups();
    markDirty();
  }

  /* ======================================================================== *
   * Field input handling
   * ======================================================================== */

  function fieldValue(field) {
    if (field.type === "checkbox") return field.checked;
    const value = field.value;

    if (field.dataset.transform === "csv") {
      return value
        .split(/[,、\n]/)
        .map((part) => part.trim())
        .filter(Boolean);
    }
    if (field.dataset.transform === "lines") {
      return value
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean);
    }
    if (field.dataset.type === "number") return Number(value) || 0;
    return value;
  }

  function handlePathInput(field) {
    const path = field.dataset.path;
    if (!path) return;

    setPath(state, path, fieldValue(field));

    if (path.startsWith("article.hero.")) updateHeroPreview();
    if (path === "article.relatedTags") updateStats();

    if (path.startsWith("categories.groups.") && path.endsWith(".color")) {
      const groupIndex = path.split(".")[2];
      const card = $(`.category-editor[data-group="${groupIndex}"]`);
      const color = String(field.value);
      if (card && /^#[0-9a-f]{6}$/i.test(color)) {
        card.style.setProperty("--category-color", color);
        const picker = $('input[type="color"]', card);
        if (picker && picker !== field) picker.value = color;
        const text = $('input[type="text"][data-path$=".color"]', card);
        if (text && text !== field) text.value = color;
      }
    }

    if (field.dataset.flag === "current" && field.checked) {
      const row = field.closest(".repeat-row");
      const soon = row?.querySelector('[data-flag="soon"]');
      if (soon) {
        soon.checked = false;
        setPath(state, soon.dataset.path, false);
      }
    }
    if (field.dataset.flag === "soon" && field.checked) {
      const row = field.closest(".repeat-row");
      const current = row?.querySelector('[data-flag="current"]');
      if (current) {
        current.checked = false;
        setPath(state, current.dataset.path, false);
      }
    }

    markDirty();
  }

  function handleTermRename(field) {
    const terms = state.article?.linkTerms;
    if (!terms) return;

    const oldKey = field.dataset.termKey;
    const newKey = field.value;
    field.classList.remove("is-invalid");

    // Allow the field to be temporarily empty while the user is retyping it.
    if (newKey === "") return;
    if (newKey === oldKey) return;

    if (Object.hasOwn(terms, newKey)) {
      field.classList.add("is-invalid");
      return;
    }

    const entries = Object.entries(terms).map(([key, value]) => (key === oldKey ? [newKey, value] : [key, value]));
    state.article.linkTerms = Object.fromEntries(entries);
    field.dataset.termKey = newKey;

    const row = field.closest(".repeat-row");
    const hrefInput = row?.querySelector("[data-term-href]");
    if (hrefInput) hrefInput.dataset.termHref = newKey;

    markDirty();
  }

  function handleTermBlur(field) {
    if (field.classList.contains("is-invalid") || field.value === "") {
      field.value = field.dataset.termKey;
      field.classList.remove("is-invalid");
    }
  }

  function handleTermHref(field) {
    const key = field.dataset.termHref;
    if (!state.article?.linkTerms || !Object.hasOwn(state.article.linkTerms, key)) return;
    state.article.linkTerms[key] = field.value;
    markDirty();
  }

  /* ======================================================================== *
   * Save / export
   * ======================================================================== */

  function sanitizeState() {
    const article = state.article;
    const categories = state.categories;
    const site = state.site;

    if (article) {
      article.categories = (article.categories ?? []).filter(Boolean);
      article.relatedTags = (article.relatedTags ?? []).filter(Boolean);
      article.breadcrumb = (article.breadcrumb ?? []).filter((row) => String(row.label ?? "").trim());
      article.actions = (article.actions ?? []).filter((row) => String(row.label ?? "").trim());
      article.sections = (article.sections ?? []).map((section) => ({
        ...section,
        level: Number(section.level) === 3 ? 3 : 2,
        blocks: section.blocks ?? [],
      }));

      const terms = Object.fromEntries(
        Object.entries(article.linkTerms ?? {})
          .map(([key, value]) => [String(key).trim(), value])
          .filter(([key]) => key),
      );
      article.linkTerms = terms;
    }

    if (categories) {
      categories.groups = (categories.groups ?? []).map((group) => ({
        ...group,
        items: (group.items ?? []).filter((item) => String(item.name ?? "").trim()),
      }));
    }

    if (site) {
      site.spotlight ??= { label: "注目", items: [] };
      site.spotlight.items = (site.spotlight.items ?? []).filter((item) =>
        String(item.label ?? "").trim(),
      );
      site.footer ??= { columns: [] };
      site.footer.columns = (site.footer.columns ?? []).map((column) => ({
        ...column,
        links: (column.links ?? []).filter((link) => String(link.label ?? "").trim()),
      }));
      site.menu ??= { sections: [] };
      site.menu.sections = (site.menu.sections ?? []).map((section) => ({
        ...section,
        links: (section.links ?? []).filter((link) => String(link.label ?? "").trim()),
      }));
    }
  }

  async function saveAll() {
    if (saving || !loaded) return;
    sanitizeState();
    saving = true;
    setStatus("saving", "保存してビルド中…");
    setSavingControls(true);
    updateSavebar();

    try {
      const response = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        throw new Error(data.error || `保存に失敗しました（HTTP ${response.status}）。`);
      }

      dirty = false;
      fillStaticFields();
      renderAll();
      syncJsonArea();
      setStatus("saved", "保存済み");
      showToast("保存して index.html を再生成しました。サイトを再読込してください。", "success", 5000);
    } catch (error) {
      console.error(error);
      setStatus("error", "保存できませんでした");
      const detail = String(error?.message || error).slice(0, 320);
      showToast(
        `${detail} 静的ホスティングの場合は「書き出し」でJSONを保存してください。`,
        "error",
        8000,
      );
    } finally {
      saving = false;
      setSavingControls(false);
      updateSavebar();
    }
  }

  function setSavingControls(isSaving) {
    for (const button of $$('[data-action="save"]')) {
      button.disabled = isSaving;
      if (button.id === "save-button") button.textContent = isSaving ? "ビルド中…" : "保存してビルド";
    }
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ------------------------------- zip ---------------------------------- */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function zipStore(entries) {
    const encoder = new TextEncoder();
    const { time, date } = dosDateTime();
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const dataBytes = encoder.encode(entry.text);
      const crc = crc32(dataBytes);

      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, time, true);
      localView.setUint16(12, date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      localChunks.push(local, dataBytes);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, time, true);
      centralView.setUint16(14, date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centralChunks.push(central);

      offset += local.length + dataBytes.length;
    }

    const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...localChunks, ...centralChunks, end], { type: "application/zip" });
  }

  function downloadAll() {
    if (!loaded) return;
    sanitizeState();
    const blob = zipStore(
      ["site", "article", "categories"].map((key) => ({
        name: `content/${key}.json`,
        text: `${JSON.stringify(state[key], null, 2)}\n`,
      })),
    );
    downloadBlob("pixpedia-content.zip", blob);
    showToast("content/*.json をZIPで書き出しました。プロジェクト直下で展開してください。", "success", 5200);
  }

  /* ======================================================================== *
   * JSON panel
   * ======================================================================== */

  function syncJsonArea() {
    if (!jsonArea || !state[jsonKey]) return;
    jsonArea.value = `${JSON.stringify(state[jsonKey], null, 2)}\n`;
    if (jsonFileTag) jsonFileTag.textContent = `${jsonKey}.json`;
    if (jsonFile) jsonFile.value = jsonKey;
  }

  function applyJson() {
    if (!jsonArea || !state[jsonKey]) return;
    let parsed;
    try {
      parsed = JSON.parse(jsonArea.value);
    } catch (error) {
      showToast(`JSONの構文エラー: ${error.message}`, "error", 6000);
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      showToast("JSONのルートはオブジェクトにしてください。", "error");
      return;
    }
    if (jsonKey === "article" && !Array.isArray(parsed.sections)) {
      showToast("article.json には sections 配列が必要です。", "error");
      return;
    }
    if (jsonKey === "categories" && !Array.isArray(parsed.groups)) {
      showToast("categories.json には groups 配列が必要です。", "error");
      return;
    }
    if (jsonKey === "site" && !parsed.site) {
      showToast("site.json には site オブジェクトが必要です。", "error");
      return;
    }

    state[jsonKey] = parsed;
    fillStaticFields();
    renderAll();
    syncJsonArea();
    markDirty();
    showToast(`${jsonKey}.json をエディタに反映しました。保存前に内容を確認してください。`, "success");
  }

  function formatJson() {
    if (!jsonArea) return;
    try {
      jsonArea.value = `${JSON.stringify(JSON.parse(jsonArea.value), null, 2)}\n`;
    } catch (error) {
      showToast(`JSONの構文エラー: ${error.message}`, "error", 6000);
    }
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const loadedFiles = {};
    const failures = [];

    for (const file of files) {
      try {
        const data = JSON.parse(await file.text());
        if (data && data.site && data.article && data.categories) {
          Object.assign(loadedFiles, {
            site: data.site,
            article: data.article,
            categories: data.categories,
          });
          continue;
        }

        const lower = file.name.toLowerCase();
        let key = "";
        if (Array.isArray(data.sections) || lower.includes("article")) key = "article";
        else if (Array.isArray(data.groups) || lower.includes("categor")) key = "categories";
        else if (data.site && (data.footer || data.header || data.menu) || lower.includes("site")) key = "site";

        if (!key) {
          failures.push(`${file.name}（種類を判別できません）`);
          continue;
        }
        loadedFiles[key] = data;
      } catch (error) {
        failures.push(`${file.name}（${error.message}）`);
      }
    }

    const next = {
      site: loadedFiles.site ?? state.site,
      article: loadedFiles.article ?? state.article,
      categories: loadedFiles.categories ?? state.categories,
    };

    if (!next.site || !next.article || !next.categories) {
      showToast("site.json / article.json / categories.json の3つを選択してください。", "error", 6000);
      if (failures.length) console.warn("読み込み失敗:", failures);
      return;
    }

    state.site = next.site;
    state.article = next.article;
    state.categories = next.categories;
    loaded = true;

    const wasHidden = app.hidden;
    if (wasHidden) {
      activePanel = "basic";
      showEditor();
    } else {
      fillStaticFields();
      renderAll();
      syncJsonArea();
    }
    markDirty();
    showToast(
      `${Object.keys(loadedFiles).length}ファイルを読み込みました。内容を確認して「保存してビルド」を押してください。`,
      "success",
      5200,
    );
  }

  /* ======================================================================== *
   * Panels
   * ======================================================================== */

  function setPanel(name, scroll = true) {
    if (!PANELS.includes(name)) return;
    const changed = activePanel !== name;
    activePanel = name;

    for (const button of $$("[data-panel-target]")) {
      const active = button.dataset.panelTarget === name;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    }
    for (const panel of $$(".editor-panel")) {
      panel.classList.toggle("is-active", panel.dataset.panel === name);
    }

    if (name === "json") syncJsonArea();
    if (changed && scroll && window.scrollY > 120) {
      $(".editor-main")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (history.replaceState) {
      try {
        const target = name === "basic" ? `${location.pathname}${location.search}` : `#${name}`;
        history.replaceState(null, "", target);
      } catch {
        /* file:// contexts may refuse history updates */
      }
    }
  }

  /* ======================================================================== *
   * Event delegation
   * ======================================================================== */

  function bindEvents() {
    document.addEventListener("input", (event) => {
      const field = event.target.closest("[data-path], [data-term-key], [data-term-href]");
      if (!field) return;
      if (field.hasAttribute("data-term-key")) return handleTermRename(field);
      if (field.hasAttribute("data-term-href")) return handleTermHref(field);
      handlePathInput(field);
    });

    document.addEventListener("change", (event) => {
      const field = event.target.closest("[data-path], [data-term-key], [data-term-href]");
      if (!field) return;
      if (field.hasAttribute("data-term-key")) return handleTermBlur(field);
      if (field.hasAttribute("data-term-href")) return;
      handlePathInput(field);
    });

    document.addEventListener("change", (event) => {
      const typeSelect = event.target.closest("[data-block-type]");
      if (typeSelect) {
        const [sectionIndex, blockIndex] = typeSelect.dataset.blockType.split(":").map(Number);
        changeBlockType(sectionIndex, blockIndex, typeSelect.value);
      }

      if (event.target === jsonFile) {
        jsonKey = jsonFile.value;
        syncJsonArea();
      }

      if (event.target.matches("#import-files, #import-files-error")) {
        importFiles(event.target.files);
        event.target.value = "";
      }
    });

    document.addEventListener("click", (event) => {
      const panelButton = event.target.closest("[data-panel-target]");
      if (panelButton) {
        setPanel(panelButton.dataset.panelTarget);
        return;
      }

      const action = event.target.closest("[data-action]");
      if (action) {
        const name = action.dataset.action;
        if (name === "save") saveAll();
        else if (name === "download-all") downloadAll();
        else if (name === "retry") loadAll().catch(showError);
        else if (name === "reload") {
          if (dirty && !window.confirm("未保存の変更は失われます。再読み込みしますか？")) return;
          loadAll().catch(showError);
        }
        return;
      }

      const add = event.target.closest("[data-add]");
      if (add) {
        addSimple(add.dataset.add, add);
        return;
      }

      if (event.target.closest("[data-add-section]")) {
        addSection();
        return;
      }

      const removeSectionButton = event.target.closest("[data-remove-section]");
      if (removeSectionButton) {
        removeSection(Number(removeSectionButton.dataset.removeSection));
        return;
      }

      const moveSectionButton = event.target.closest("[data-move-section]");
      if (moveSectionButton) {
        moveSection(Number(moveSectionButton.dataset.moveSection), Number(moveSectionButton.dataset.delta));
        return;
      }

      const addBlockButton = event.target.closest("[data-add-block]");
      if (addBlockButton) {
        addBlock(Number(addBlockButton.dataset.addBlock));
        return;
      }

      const removeBlockButton = event.target.closest("[data-remove-block]");
      if (removeBlockButton) {
        const [sectionIndex, blockIndex] = removeBlockButton.dataset.removeBlock.split(":").map(Number);
        removeBlock(sectionIndex, blockIndex);
        return;
      }

      const moveBlockButton = event.target.closest("[data-move-block]");
      if (moveBlockButton) {
        const [sectionIndex, blockIndex] = moveBlockButton.dataset.moveBlock.split(":").map(Number);
        moveBlock(sectionIndex, blockIndex, Number(moveBlockButton.dataset.delta));
        return;
      }

      if (event.target.closest("[data-add-group]")) {
        addGroup();
        return;
      }

      const removeGroupButton = event.target.closest("[data-remove-group]");
      if (removeGroupButton) {
        removeGroup(Number(removeGroupButton.dataset.removeGroup));
        return;
      }

      const moveGroupButton = event.target.closest("[data-move-group]");
      if (moveGroupButton) {
        moveGroup(Number(moveGroupButton.dataset.moveGroup), Number(moveGroupButton.dataset.delta));
        return;
      }

      const addItemButton = event.target.closest("[data-add-cat-item]");
      if (addItemButton) {
        addCategoryItem(Number(addItemButton.dataset.addCatItem));
        return;
      }

      const addFooterLink = event.target.closest("[data-add-footer-link]");
      if (addFooterLink) {
        const columnIndex = Number(addFooterLink.dataset.addFooterLink);
        state.site.footer.columns[columnIndex].links ??= [];
        state.site.footer.columns[columnIndex].links.push({ label: "新しいリンク", href: "#top" });
        renderFooterColumns();
        markDirty();
        return;
      }

      const addMenuLink = event.target.closest("[data-add-menu-link]");
      if (addMenuLink) {
        const sectionIndex = Number(addMenuLink.dataset.addMenuLink);
        state.site.menu.sections[sectionIndex].links ??= [];
        state.site.menu.sections[sectionIndex].links.push({ label: "新しいリンク", href: "#top" });
        renderMenuSections();
        markDirty();
        return;
      }

      const removeArrayButton = event.target.closest("[data-remove-array]");
      if (removeArrayButton) {
        const path = removeArrayButton.dataset.removeArray;
        const index = Number(removeArrayButton.dataset.index);
        const array = getPath(state, path);
        if (Array.isArray(array)) {
          if (path === "site.footer.columns" || path === "site.menu.sections") {
            if (!confirmRemove("このまとまりを削除しますか？")) return;
          }
          array.splice(index, 1);
          renderForPath(path);
          markDirty();
        }
        return;
      }

      const moveArrayButton = event.target.closest("[data-move-array]");
      if (moveArrayButton) {
        const path = moveArrayButton.dataset.moveArray;
        const index = Number(moveArrayButton.dataset.index);
        const delta = Number(moveArrayButton.dataset.delta);
        const array = getPath(state, path);
        const target = index + delta;
        if (Array.isArray(array) && target >= 0 && target < array.length) {
          [array[index], array[target]] = [array[target], array[index]];
          renderForPath(path);
          markDirty();
        }
        return;
      }

      const removeTermButton = event.target.closest("[data-remove-term]");
      if (removeTermButton) {
        delete state.article.linkTerms[removeTermButton.dataset.removeTerm];
        renderLinkTerms();
        markDirty();
        return;
      }

      const jsonAction = event.target.closest("[data-json-action]");
      if (jsonAction) {
        const name = jsonAction.dataset.jsonAction;
        if (name === "format") formatJson();
        else if (name === "apply") applyJson();
        else if (name === "download") {
          try {
            const parsed = JSON.parse(jsonArea.value);
            const payload = `${JSON.stringify(parsed, null, 2)}\n`;
            downloadBlob(`${jsonKey}.json`, new Blob([payload], { type: "application/json" }));
            showToast(`${jsonKey}.json を書き出しました。`, "success");
          } catch (error) {
            showToast(`JSONの構文エラー: ${error.message}`, "error", 6000);
          }
        }
      }
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveAll();
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (!dirty || saving) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  /* ======================================================================== *
   * Boot
   * ======================================================================== */

  function boot() {
    bindEvents();
    const hash = window.location.hash.slice(1);
    if (PANELS.includes(hash)) activePanel = hash;

    loadAll().catch(showError);
  }

  boot();
})();
