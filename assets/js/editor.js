/* ==========================================================================
   In-page content editor.

   The editor lives in index.html and opens as a full-screen overlay, so
   moving between the article and the editor never reloads the page. Changes
   are saved to localStorage automatically. Uploaded images stay in memory
   only; the store replaces their data: URLs with an empty string.
   ========================================================================== */

(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const overlay = $("#editor-overlay");
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
  const importInputs = [$("#import-files"), $("#import-files-error")].filter(Boolean);

  let state = { site: null, article: null };
  const PANELS = ["basic", "body", "export"];
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

  let activePanel = "basic";
  let dirty = false;
  let loaded = false;
  let isOpen = false;
  let toastTimer = 0;
  let persistTimer = 0;
  let savedScrollY = 0;

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

  function updateSavebar() {
    if (!savebar) return;
    savebar.hidden = !dirty;
    if (savebarText) savebarText.textContent = "変更を自動保存しています…";
  }

  function schedulePersist() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => persistNow({ silent: true }), 350);
  }

  function persistNow({ silent = false } = {}) {
    if (!loaded || !state.article) return false;
    window.clearTimeout(persistTimer);
    const result = WindowStoreSafe.save(state);
    if (!result.ok) {
      setStatus("error", "保存できませんでした");
      showToast(
        `このブラウザに保存できませんでした（${result.error?.message || "容量不足の可能性"}）。JSONで書き出して保管してください。`,
        "error",
        8000,
      );
      return false;
    }
    dirty = false;
    const uploaded = WindowStoreSafe.countUploadedAssets(state);
    setStatus("saved", uploaded ? "保存済み（画像は再選択）" : "このブラウザに保存済み");
    if (statusEl) {
      statusEl.title = uploaded
        ? "アップロードした画像は保存されません。再訪時に選び直してください。"
        : "編集内容はこのブラウザのlocalStorageに保存されています。";
    }
    updateSavebar();
    if (!silent) showToast("このブラウザに保存しました。", "success");
    return true;
  }

  function markDirty() {
    if (!loaded) return;
    dirty = true;
    setStatus("dirty", "自動保存しています…");
    updateSavebar();
    schedulePersist();
  }

  // A tiny indirection so the store can be mocked in tests if needed.
  const WindowStoreSafe = {
    save: (value) => window.WikiStore.save(value),
    fetchDefaults: () => window.WikiStore.fetchDefaults(),
    countUploadedAssets: (value) => window.WikiStore.countUploadedAssets(value),
  };

  function selected(value, current) {
    return String(value) === String(current) ? " selected" : "";
  }

  function checked(value) {
    return value ? " checked" : "";
  }

  function emptyState(message) {
    return `<p class="empty-state">${esc(message)}</p>`;
  }

  function isDataUrl(value) {
    return typeof value === "string" && value.trim().startsWith("data:");
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("画像を読み込めませんでした。"));
      reader.readAsDataURL(file);
    });
  }

  /* ======================================================================== *
   * Loading / showing / error
   * ======================================================================== */

  function adoptState(next) {
    state = next;
    loaded = true;
    showEditor();
  }

  function showEditor() {
    loading.hidden = true;
    errorBox.hidden = true;
    app.hidden = false;
    fillStaticFields();
    renderAll();
    setPanel(activePanel, false);
    dirty = false;
    setStatus("saved", WindowStoreSafe.countUploadedAssets(state) ? "保存済み（画像は再選択）" : "このブラウザに保存済み");
    updateSavebar();
  }

  function showError(error) {
    loaded = false;
    loading.hidden = true;
    app.hidden = true;
    errorBox.hidden = false;

    const detail = error?.message ? `（${error.message}）` : "";
    errorMessage.textContent = `${detail} JSONを読み込むか、サーバー経由でページを開き直してください。`;
    setStatus("error", "読み込みエラー");
  }

  function fillStaticFields() {
    if (!state.article) return;
    for (const field of $$("[data-path]")) {
      const path = field.dataset.path;
      const value = getPath(state, path);

      if (field.type === "checkbox") {
        field.checked = Boolean(value);
      } else if (field.type === "file") {
        continue;
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
    const src = state.article?.hero?.src || "";
    if (!src) {
      heroPreview.removeAttribute("src");
      heroPreview.alt = "";
      heroPreview.hidden = true;
      return;
    }
    heroPreview.hidden = false;
    if (heroPreview.getAttribute("src") !== src) heroPreview.setAttribute("src", src);
    heroPreview.alt = state.article?.hero?.alt || "";
  }

  /* ======================================================================== *
   * Main renderers
   * ======================================================================== */

  function renderAll() {
    renderActions();
    renderSections();
    updateStats();
    updateHeroPreview();
  }

  function updateStats() {
    const sections = state.article?.sections ?? [];
    const blocks = sections.reduce((sum, section) => sum + (section.blocks?.length || 0), 0);
    const tags = state.article?.relatedTags?.length ?? 0;

    const setText = (selector, value) => {
      const element = $(selector);
      if (element) element.textContent = value;
    };

    setText("#stat-sections", sections.length);
    setText("#stat-blocks", blocks);
    setText("#stat-tags", tags);
    setText("#section-count-label", sections.length);

    for (const node of $$('[data-count="sections"]')) node.textContent = sections.length;
    for (const node of $$('[data-count="blocks"]')) node.textContent = blocks;
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
  <label class="repeat-row__check"><input type="checkbox" data-path="article.actions.${index}.primary"${checked(row.primary)}>太字</label>
  <button type="button" class="row-icon-button" data-remove-array="article.actions" data-index="${index}" aria-label="このリンクを削除">×</button>
</div>`,
          )
          .join("")
      : emptyState("ヘッダーリンクはまだありません。");
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

      case "figure": {
        const src = block.src || "";
        const preview = src
          ? `<div class="image-preview"><img src="${attr(src)}" alt="" data-image-preview="${path}.src"></div>`
          : `<p class="block-editor__empty">画像が設定されていません。</p>`;
        return `<div class="field-grid">
  <label class="field field--full">
    <span class="field__label">画像をアップロード</span>
    <input type="file" accept="image/*" data-upload-image="${path}.src">
    <span class="field__hint">アップロード画像はブラウザに保存されません。再訪時は再選択してください。</span>
  </label>
  <label class="field field--full">
    <span class="field__label">画像パス</span>
    <input type="text" data-path="${path}.src" value="${attr(src)}" placeholder="assets/images/pointer-map.svg">
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
  <div class="field field--full field--preview">${preview}</div>
</div>`;
      }

      case "tags":
        return `<label class="field field--full">
  <span class="field__label">タグ（1行に1つ）</span>
  <textarea rows="4" data-path="${path}.items" data-transform="lines" placeholder="プログラミング言語&#10;ポインタ">${esc((block.items || []).join("\n"))}</textarea>
  <span class="field__hint">本文中のタグボタンになります。検索にも追加されます。</span>
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

  /* ======================================================================== *
   * Structural operations
   * ======================================================================== */

  function renderForPath(path = "") {
    if (path.startsWith("article.actions")) return renderActions();
    if (path.startsWith("article.sections")) return renderSections();
    return renderAll();
  }

  function confirmRemove(message) {
    return window.confirm(`${message}\n\nこの操作はこのブラウザに自動保存されます。`);
  }

  function addSimple(kind, anchor) {
    if (!state.article || !state.site) return;

    switch (kind) {
      case "action":
        state.article.actions ??= [];
        state.article.actions.push({ label: "新しいリンク" });
        renderActions();
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
    if (path.endsWith(".src")) {
      const preview = $(`img[data-image-preview="${path}"]`);
      if (preview) {
        preview.setAttribute("src", field.value);
        preview.hidden = !field.value;
      }
    }

    markDirty();
  }

  async function handleImageUpload(input) {
    const path = input.dataset.uploadImage;
    const file = input.files?.[0];
    if (!path || !file) return;

    if (!file.type.startsWith("image/")) {
      showToast("画像ファイルを選択してください。", "error");
      input.value = "";
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      showToast("画像が大きすぎます。12MB以下の画像を選択してください。", "error", 6000);
      input.value = "";
      return;
    }

    try {
      const dataUrl = await readFileAsDataURL(file);
      setPath(state, path, dataUrl);

      if (path.startsWith("article.hero.")) {
        fillStaticFields();
      } else if (path.startsWith("article.sections.")) {
        renderSections();
      }
      markDirty();
      showToast("画像を設定しました。この画像はブラウザに保存されません。", "info", 5200);
    } catch (error) {
      showToast(`画像を読み込めませんでした（${error.message}）。`, "error", 6000);
    } finally {
      input.value = "";
    }
  }

  /* ======================================================================== *
   * Persistence
   * ======================================================================== */

  function sanitizeState() {
    const article = state.article;

    if (article) {
      article.relatedTags = (article.relatedTags ?? []).filter(Boolean);
      article.actions = (article.actions ?? []).filter((row) => String(row.label ?? "").trim());
      article.sections = (article.sections ?? []).map((section) => ({
        ...section,
        level: Number(section.level) === 3 ? 3 : 2,
        blocks: section.blocks ?? [],
      }));
    }
  }

  async function handleExport(kind) {
    if (!loaded) return;
    sanitizeState();

    const buttons = $$("[data-export]");
    const label = kind.toUpperCase();
    for (const button of buttons) button.disabled = true;
    setStatus("saving", `${label} を書き出しています…`);

    try {
      if (kind === "json") {
        WikiExport.exportJSON(state);
      } else if (kind === "html") {
        await WikiExport.exportHTML(state);
      } else if (kind === "png") {
        await WikiExport.exportPNG(state);
      } else if (kind === "pdf") {
        await WikiExport.exportPDF(state);
      }
      showToast(`${label} を書き出しました。`, "success", 5200);
    } catch (error) {
      console.error(error);
      showToast(`${label} の書き出しに失敗しました（${error.message}）。`, "error", 8000);
    } finally {
      for (const button of buttons) button.disabled = false;
      setStatus("saved", WindowStoreSafe.countUploadedAssets(state) ? "保存済み（画像は再選択）" : "このブラウザに保存済み");
    }
  }

  async function resetToDefaults() {
    if (!window.confirm("このブラウザに保存した編集内容を削除して、初期データに戻しますか？")) return;
    try {
      const defaults = await WindowStoreSafe.fetchDefaults();
      window.WikiStore.clear();
      state = defaults;
      loaded = true;
      window.WikiSite.setState(state);
      showEditor();
      persistNow({ silent: true });
      showToast("初期データに戻しました。", "success");
    } catch (error) {
      showToast(`初期データを読み込めませんでした（${error.message}）。`, "error", 6000);
    }
  }

  async function reloadFromSource() {
    try {
      const next = await window.WikiStore.load();
      state = next;
      loaded = true;
      window.WikiSite.setState(state);
      showEditor();
      showToast("最新のデータを読み込みました。", "success");
    } catch (error) {
      showError(error);
    }
  }

  /* ======================================================================== *
   * Import
   * ======================================================================== */

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const loadedFiles = {};
    const failures = [];

    for (const file of files) {
      try {
        const data = JSON.parse(await file.text());
        if (data && data.site && data.article) {
          Object.assign(loadedFiles, {
            site: data.site,
            article: data.article,
          });
          continue;
        }

        const lower = file.name.toLowerCase();
        let key = "";
        if (Array.isArray(data.sections) || lower.includes("article")) key = "article";
        else if ((data.site && (data.footer || data.header || data.menu)) || lower.includes("site")) key = "site";

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
    };

    if (!next.site || !next.article) {
      showToast("site・article を含むJSONを選択してください。", "error", 6000);
      if (failures.length) console.warn("読み込み失敗:", failures);
      return;
    }

    const check = window.WikiStore.validate(next);
    if (check.errors.length) {
      showToast(`読み込めませんでした: ${check.errors[0]}`, "error", 8000);
      if (failures.length) console.warn("読み込み失敗:", failures);
      return;
    }

    state.site = next.site;
    state.article = next.article;
    loaded = true;
    sanitizeState();
    window.WikiSite.setState(state);

    fillStaticFields();
    renderAll();
    markDirty();
    persistNow({ silent: true });
    showToast(
      `${Object.keys(loadedFiles).length}ファイルを読み込み、このブラウザに保存しました。`,
      "success",
      5200,
    );
  }

  /* ======================================================================== *
   * Open / close
   * ======================================================================== */

  function openEditor() {
    if (!overlay) return;
    savedScrollY = window.scrollY;
    overlay.hidden = false;
    document.body.classList.add("is-editor-open");
    isOpen = true;
    overlay.scrollTop = 0;

    if (loaded) {
      fillStaticFields();
      renderAll();
      dirty = false;
      setStatus("saved", WindowStoreSafe.countUploadedAssets(state) ? "保存済み（画像は再選択）" : "このブラウザに保存済み");
      updateSavebar();
    } else {
      loading.hidden = true;
      app.hidden = true;
      errorBox.hidden = false;
      errorMessage.textContent =
        "編集データを読み込めていません。JSONを読み込むか、ページを再読み込みしてください。";
      setStatus("error", "読み込みエラー");
    }

    try {
      window.history.replaceState(null, "", `${location.pathname}${location.search}#editor`);
    } catch {
      /* file:// contexts may refuse history updates */
    }

    window.requestAnimationFrame(() => {
      ($(".editor-nav__item.is-active") || $(".editor-brand"))?.focus({ preventScroll: true });
    });
  }

  function closeEditor() {
    if (!overlay || overlay.hidden) return;
    persistNow({ silent: true });
    overlay.hidden = true;
    document.body.classList.remove("is-editor-open");
    isOpen = false;

    try {
      window.history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch {
      /* noop */
    }

    window.WikiSite.render();
    window.scrollTo({ top: savedScrollY, behavior: "auto" });
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

    if (changed && scroll) {
      overlay?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  /* ======================================================================== *
   * Event delegation
   * ======================================================================== */

  function bindEvents() {
    document.addEventListener("input", (event) => {
      const field = event.target.closest("[data-path]");
      if (!field) return;
      handlePathInput(field);
    });

    document.addEventListener("change", (event) => {
      const field = event.target.closest("[data-path]");
      if (field) handlePathInput(field);

      const typeSelect = event.target.closest("[data-block-type]");
      if (typeSelect) {
        const [sectionIndex, blockIndex] = typeSelect.dataset.blockType.split(":").map(Number);
        changeBlockType(sectionIndex, blockIndex, typeSelect.value);
      }

      if (event.target.matches("#import-files, #import-files-error")) {
        importFiles(event.target.files);
        event.target.value = "";
      }

      const upload = event.target.closest("[data-upload-image]");
      if (upload) handleImageUpload(upload);
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-editor]")) {
        event.preventDefault();
        closeEditor();
        return;
      }

      const panelButton = event.target.closest("[data-panel-target]");
      if (panelButton) {
        setPanel(panelButton.dataset.panelTarget);
        return;
      }

      const action = event.target.closest("[data-action]");
      if (action) {
        const name = action.dataset.action;
        if (name === "save") persistNow({ silent: false });
        else if (name === "reset-default") resetToDefaults();
        else if (name === "retry") reloadFromSource();
        return;
      }

      const exportButton = event.target.closest("[data-export]");
      if (exportButton) {
        handleExport(exportButton.dataset.export);
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

      const removeArrayButton = event.target.closest("[data-remove-array]");
      if (removeArrayButton) {
        const path = removeArrayButton.dataset.removeArray;
        const index = Number(removeArrayButton.dataset.index);
        const array = getPath(state, path);
        if (Array.isArray(array)) {
          array.splice(index, 1);
          renderForPath(path);
          markDirty();
        }
        return;
      }
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        persistNow({ silent: false });
      }
    });

    window.addEventListener("pagehide", () => {
      if (loaded) persistNow({ silent: true });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && loaded) persistNow({ silent: true });
    });

    window.addEventListener("popstate", () => {
      if (location.hash === "#editor") openEditor();
      else closeEditor();
    });
  }

  /* ======================================================================== *
   * Boot
   * ======================================================================== */

  function boot() {
    bindEvents();

    if (!window.WikiSite?.ready) {
      showError(new Error("サイトの初期化に失敗しました。"));
      return;
    }

    window.WikiSite.ready
      .then((next) => {
        adoptState(next);
        if (location.hash === "#editor") openEditor();
      })
      .catch(showError);

    window.WikiEditor = {
      open: openEditor,
      close: closeEditor,
      isOpen: () => isOpen,
    };
  }

  boot();
})();
