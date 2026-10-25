import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "content");
const warnings = [];

const readJSON = async (file) => JSON.parse(await readFile(path.join(CONTENT, file), "utf8"));
const site = await readJSON("site.json");
const article = await readJSON("article.json");
const categories = await readJSON("categories.json");

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

const esc = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const attr = esc;
const stripControl = (value = "") => String(value).replaceAll("\u0001", "");

function safeHref(raw = "") {
  const href = String(raw).trim();
  if (/^(?:#|\/|\.{1,2}\/|https?:\/\/|mailto:)/i.test(href)) return href;
  // Relative paths may contain non-ASCII characters (Japanese anchors, file names).
  if (/^[\w./?=&%#+\-\u0080-\uFFFF]+$/.test(href)) return href;
  return "#";
}

function isExternal(href = "") {
  return /^https?:\/\//i.test(href);
}

function linkAttrs(href) {
  return isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
}

function inline(value, linkTerms = {}) {
  let text = stripControl(value ?? "");
  const held = [];
  const hold = (html) => `\u0001${held.push(html) - 1}\u0001`;

  text = text.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`));

  text = text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, term, label) => {
    const target = linkTerms[term];
    if (!target) {
      warnings.push(`linkTerms に「${term}」がありません（本文中で平文として表示）`);
      return term;
    }
    const href = safeHref(target);
    return hold(`<a href="${attr(href)}"${linkAttrs(href)}>${esc(label || term)}</a>`);
  });

  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const safe = safeHref(href);
    return hold(`<a href="${attr(safe)}"${linkAttrs(safe)}>${esc(label)}</a>`);
  });

  text = esc(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return text.replace(/\u0001(\d+)\u0001/g, (_, index) => held[Number(index)] ?? "");
}

function plainText(value) {
  return String(value ?? "")
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, term, label) => label || term)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function plainBlock(block) {
  switch (block.type) {
    case "paragraph":
      return plainText(block.text);
    case "list":
      return [block.title, ...(block.items || []).map(plainText)].filter(Boolean).join(" / ");
    case "code":
      return `${block.filename || ""} ${block.language || ""} ${block.code || ""}`.trim();
    case "callout":
      return [block.title, plainText(block.text)].filter(Boolean).join("：");
    case "tags":
      return (block.items || []).join(" / ");
    case "figure":
      return [block.alt, block.caption, block.credit].filter(Boolean).join(" / ");
    case "quote":
      return [plainText(block.text), block.cite].filter(Boolean).join(" / ");
    default:
      return "";
  }
}

function sectionPlainText(section) {
  return (section.blocks || []).map(plainBlock).filter(Boolean).join(" ");
}

function validate() {
  if (!site?.site?.name) throw new Error("content/site.json: site.name は必須です");
  if (!article?.title) throw new Error("content/article.json: title は必須です");
  if (!Array.isArray(article.sections)) throw new Error("content/article.json: sections は配列で指定してください");
  if (!Array.isArray(categories.groups)) throw new Error("content/categories.json: groups は配列で指定してください");

  const ids = new Set();
  for (const [index, section] of article.sections.entries()) {
    if (!section.id) section.id = `section-${index + 1}`;
    if (ids.has(section.id)) throw new Error(`section id が重複しています: ${section.id}`);
    ids.add(section.id);
    if (![2, 3].includes(Number(section.level))) warnings.push(`section「${section.title}」の level は 2 か 3 を推奨します`);
    if (!section.title) throw new Error(`sections[${index}].title は必須です`);
    if (!Array.isArray(section.blocks)) section.blocks = [];
  }

  const categoryIds = new Set();
  for (const group of categories.groups) {
    if (!group.id) group.id = `category-${categoryIds.size + 1}`;
    if (categoryIds.has(group.id)) throw new Error(`category id が重複しています: ${group.id}`);
    categoryIds.add(group.id);
    if (!group.name) throw new Error("categories.groups[].name は必須です");
    if (!Array.isArray(group.items)) group.items = [];
    for (const item of group.items) {
      if (!item.name) throw new Error(`カテゴリ「${group.name}」に名前のない項目があります`);
    }
  }

  const groupNames = new Set(categories.groups.map((group) => group.name));
  for (const name of article.categories || []) {
    if (!groupNames.has(name)) warnings.push(`記事のカテゴリ「${name}」に対応するグループが categories.json にありません`);
  }
}

async function checkLocalAsset(src, label) {
  if (!src || isExternal(src) || src.startsWith("data:")) return;
  const clean = src.split(/[?#]/)[0].replace(/^\.?\//, "");
  try {
    await access(path.join(ROOT, clean));
  } catch {
    throw new Error(`${label} の画像が見つかりません: ${src}`);
  }
}

await validate();
await checkLocalAsset(article.hero?.src, "hero");
for (const section of article.sections) {
  for (const block of section.blocks) {
    if (block.type === "figure") await checkLocalAsset(block.src, `figure (${section.title})`);
  }
}

/* ------------------------------------------------------------------ *
 * computed data
 * ------------------------------------------------------------------ */

let major = 0;
let minor = 0;
let orphan = 0;
const tocEntries = article.sections.map((section) => {
  let number;
  if (Number(section.level) === 2) {
    major += 1;
    minor = 0;
    number = String(major);
  } else {
    if (major === 0) {
      orphan += 1;
      number = `0.${orphan}`;
    } else {
      minor += 1;
      number = `${major}.${minor}`;
    }
  }
  return { ...section, number };
});

const totalBlocks = article.sections.reduce((sum, section) => sum + (section.blocks?.length || 0), 0);
const totalItems = categories.groups.reduce((sum, group) => sum + (group.items?.length || 0), 0);
const uniqueItems = new Set(categories.groups.flatMap((group) => group.items.map((item) => item.name))).size;
const tags = article.relatedTags || [];
const categoryByName = new Map(categories.groups.map((group) => [group.name, group]));

const searchIndex = {
  sections: tocEntries.map((section) => ({
    type: "節",
    title: `${section.number} ${section.title}`,
    text: sectionPlainText(section),
    href: `#${section.id}`,
    id: section.id,
  })),
  categories: categories.groups.map((group) => ({
    type: "カテゴリ",
    title: group.name,
    text: [group.description, ...group.items.map((item) => item.name)].filter(Boolean).join(" / "),
    href: `#category-${group.id}`,
    id: `category-${group.id}`,
  })),
  tags: tags.map((tag) => ({
    type: "タグ",
    title: tag,
    text: `関連タグ「${tag}」`,
    href: "#related-tags",
    id: "related-tags",
  })),
};

/* ------------------------------------------------------------------ *
 * render pieces
 * ------------------------------------------------------------------ */

function renderBlock(block, index, sectionTitle) {
  switch (block.type) {
    case "paragraph":
      return `<p>${inline(block.text, article.linkTerms)}</p>`;

    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const title = block.title ? `<p class="block-label">${inline(block.title, article.linkTerms)}</p>` : "";
      const items = (block.items || [])
        .map((item) => `<li>${inline(item, article.linkTerms)}</li>`)
        .join("\n");
      return `${title}<${tag} class="body-list">${items}</${tag}>`;
    }

    case "code": {
      const language = esc(block.language || "text");
      const filename = block.filename
        ? `<span class="code-block__file">${esc(block.filename)}</span>`
        : `<span class="code-block__file">snippet</span>`;
      return `<div class="code-block">
  <div class="code-block__bar">${filename}<span class="code-block__language">${language}</span><button type="button" class="code-block__copy" data-copy>コピー</button></div>
  <pre tabindex="0"><code>${esc(block.code || "")}</code></pre>
</div>`;
    }

    case "callout": {
      const tone = ["info", "warn", "parody"].includes(block.tone) ? block.tone : "info";
      const icon = tone === "warn" ? "!" : tone === "parody" ? "?" : "i";
      return `<aside class="callout callout--${tone}">
  <span class="callout__icon" aria-hidden="true">${icon}</span>
  <div class="callout__body">
    ${block.title ? `<p class="callout__title">${inline(block.title, article.linkTerms)}</p>` : ""}
    <p>${inline(block.text, article.linkTerms)}</p>
  </div>
</aside>`;
    }

    case "tags":
      return `<div class="tag-cloud">${(block.items || [])
        .map((tag) => `<button type="button" class="tag" data-search="${attr(tag)}">#${esc(tag)}</button>`)
        .join("")}</div>`;

    case "figure":
      return `<figure class="article-figure">
  <img src="${attr(block.src)}" alt="${attr(block.alt || "")}" loading="lazy">
  <figcaption><span>${inline(block.caption || "", article.linkTerms)}</span>${block.credit ? `<span class="article-figure__credit">${esc(block.credit)}</span>` : ""}</figcaption>
</figure>`;

    case "quote":
      return `<blockquote class="article-quote"><p>${inline(block.text, article.linkTerms)}</p>${block.cite ? `<cite>${esc(block.cite)}</cite>` : ""}</blockquote>`;

    case "divider":
      return `<hr class="article-divider">`;

    default:
      warnings.push(`未対応の block type「${block.type}」（${sectionTitle}）`);
      return `<!-- 未対応 block: ${esc(block.type)} -->`;
  }
}

function renderSection(section) {
  const isSub = Number(section.level) === 3;
  const headingTag = isSub ? "h3" : "h2";
  const blocks = (section.blocks || [])
    .map((block, index) => renderBlock(block, index, section.title))
    .join("\n");
  const rule = isSub ? "" : '<span class="section__rule" aria-hidden="true"></span>';
  return `<section class="section${isSub ? " section--sub" : ""}" id="${attr(section.id)}" data-section>
  <div class="section__heading">
    <${headingTag} class="section__title">${esc(section.title)}<a class="section__anchor" href="#${attr(section.id)}" aria-label="${attr(section.title)}へのリンク" title="この節へのリンク">#</a></${headingTag}>
    ${rule}
  </div>
  <div class="section__content">
${blocks}
  </div>
</section>`;
}

function renderCategoryCards() {
  return categories.groups
    .map((group) => {
      const items = group.items
        .map((item) => {
          if (item.soon) {
            return `<li><button type="button" class="category-chip is-soon" data-soon="${attr(item.name)}" title="このパロディ版では未作成">${esc(item.name)}</button></li>`;
          }
          const href = safeHref(item.href || "#categories");
          const current = item.current
            ? '<span class="category-chip__badge">この記事</span>'
            : "";
          return `<li><a class="category-chip${item.current ? " is-current" : ""}" href="${attr(href)}">${esc(item.name)}${current}</a></li>`;
        })
        .join("");
      return `<article class="category-card" id="category-${attr(group.id)}" style="--category-color:${attr(group.color || "#5b7c99")}">
  <header class="category-card__head">
    <span class="category-card__dot" aria-hidden="true"></span>
    <h3>${esc(group.name)}</h3>
    <span class="count-badge">${group.items.length}項目</span>
  </header>
  <p class="category-card__description">${esc(group.description || "")}</p>
  <ul class="category-card__items">${items}</ul>
</article>`;
    })
    .join("\n");
}

function renderBreadcrumb() {
  const items = [
    `<a href="#top">${esc(site.site.name)}</a>`,
    ...(article.breadcrumb || []).map((item) => `<a href="${attr(safeHref(item.href || "#categories"))}">${esc(item.label)}</a>`),
    `<span aria-current="page">${esc(article.title)}</span>`,
  ];
  const separator = '<span class="breadcrumb__sep" aria-hidden="true">›</span>';
  return items.join(separator);
}

function renderArticleActions() {
  return (article.actions || [])
    .map((action) => {
      const href = safeHref(action.href || "#top");
      return `<li><a class="article-action${action.primary ? " is-primary" : ""}" href="${attr(href)}"${linkAttrs(href)}><span>${esc(action.label)}</span><span class="article-action__chevron" aria-hidden="true">›</span></a></li>`;
    })
    .join("");
}

function renderArticleCategories() {
  return (article.categories || [])
    .map((name) => {
      const group = categoryByName.get(name);
      if (!group) return `<li><span class="category-tag">${esc(name)}</span></li>`;
      return `<li><a class="category-tag" href="#category-${attr(group.id)}">${esc(name)}</a></li>`;
    })
    .join("");
}

function renderToc() {
  return tocEntries
    .map(
      (section) => `<li class="toc__item${Number(section.level) === 3 ? " toc__item--sub" : ""}">
  <a href="#${attr(section.id)}"><span class="toc__num">${section.number}</span><span>${esc(section.title)}</span></a>
</li>`,
    )
    .join("\n");
}

function renderSidebarCategories() {
  return categories.groups
    .map(
      (group) => `<li>
  <a class="side-cat" href="#category-${attr(group.id)}">
    <span class="side-cat__dot" style="--category-color:${attr(group.color || "#5b7c99")}" aria-hidden="true"></span>
    <span class="side-cat__name">${esc(group.name)}</span>
    <span class="side-cat__count">${group.items.length}</span>
  </a>
</li>`,
    )
    .join("");
}

function renderFooterColumns() {
  return (site.footer.columns || [])
    .map((column) => {
      const links = (column.links || [])
        .map((link) => {
          if (link.action === "history") {
            return `<li><button type="button" class="footer-link" data-action="history">${esc(link.label)}</button></li>`;
          }
          if (link.action === "soon") {
            return `<li><button type="button" class="footer-link" data-action="soon" data-message="English版は準備中です。">${esc(link.label)}</button></li>`;
          }
          const href = safeHref(link.href || "#top");
          return `<li><a class="footer-link" href="${attr(href)}"${linkAttrs(href)}>${esc(link.label)}</a></li>`;
        })
        .join("");
      return `<div class="footer-column">
  <h3>${esc(column.title)}</h3>
  <ul>${links}</ul>
</div>`;
    })
    .join("\n");
}

function renderSpotlight() {
  if (!site.spotlight?.items?.length) return "";
  const items = site.spotlight.items
    .map((item) => {
      if (item.query) {
        return `<button type="button" class="spotlight__link" data-search="${attr(item.query)}">${esc(item.label)}</button>`;
      }
      const href = safeHref(item.href || "#top");
      return `<a class="spotlight__link" href="${attr(href)}"${linkAttrs(href)}>${esc(item.label)}</a>`;
    })
    .join("");
  return `<div class="spotlight" aria-label="注目の項目">
  <div class="spotlight__inner">
    <span class="spotlight__label">${esc(site.spotlight.label || "注目")}</span>
    <div class="spotlight__items">${items}</div>
  </div>
</div>`;
}

function renderHistoryDialog() {
  const items = (article.history || [])
    .map((entry) => `<li><time datetime="${attr(entry.date)}">${esc(entry.date)}</time><span>${esc(entry.note)}</span></li>`)
    .join("");
  return `<dialog class="dialog" id="history-dialog" aria-labelledby="history-title">
  <div class="dialog__head">
    <h2 id="history-title">編集履歴</h2>
    <button type="button" class="dialog__close" data-close-dialog aria-label="閉じる">×</button>
  </div>
  <ol class="history-list">${items}</ol>
  <div class="dialog__foot"><button type="button" class="button button--soft" data-close-dialog>閉じる</button></div>
</dialog>`;
}

function renderMobileMenu() {
  const sections = (site.menu?.sections || [])
    .map(
      (section) => `<section class="drawer-section">
  <h2>${esc(section.title)}</h2>
  <ul>${(section.links || [])
    .map((link) => {
      const href = safeHref(link.href || "#top");
      return `<li><a href="${attr(href)}"${linkAttrs(href)}>${esc(link.label)}</a></li>`;
    })
    .join("")}</ul>
</section>`,
    )
    .join("");
  return `<div class="drawer-overlay" id="drawer-overlay" hidden>
  <div class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1">
    <div class="drawer__head">
      <span class="drawer__title" id="drawer-title">${esc(site.menu?.title || "メニュー")}</span>
      <button type="button" class="icon-button icon-button--dark" data-close-menu aria-label="メニューを閉じる">×</button>
    </div>
    <div class="drawer__body">
      ${sections}
      <section class="drawer-section">
        <h2>カテゴリ</h2>
        <ul>${categories.groups
          .map((group) => `<li><a href="#category-${attr(group.id)}">${esc(group.name)}<span class="drawer-count">${group.items.length}</span></a></li>`)
          .join("")}</ul>
      </section>
      <div class="drawer__cta">
        <a class="button button--blue button--wide" href="editor.html">コンテンツエディタを開く</a>
        <a class="button button--soft button--wide" href="guide.html">編集ガイド</a>
      </div>
    </div>
  </div>
</div>`;
}

function renderFooter() {
  return `<footer class="site-footer" id="site-footer">
  <div class="footer__inner">
    <div class="footer__brand">
      <a class="footer-brand" href="#top">
        <img src="${attr(site.site.mark)}" alt="" width="28" height="28">
        <span>${esc(site.site.name)}<em>${esc(site.site.badge || "PARODY")}</em></span>
      </a>
      <p>${esc(site.footer.blurb || site.site.tagline || "")}</p>
    </div>
    <div class="footer__columns">${renderFooterColumns()}</div>
    <div class="footer__legal">
      <p>${esc(site.footer.disclaimer || "")}</p>
      <p>${esc(site.footer.copyright || "")}</p>
    </div>
  </div>
</footer>`;
}

/* ------------------------------------------------------------------ *
 * page
 * ------------------------------------------------------------------ */

const hero = article.hero || {};
const pageTitle = `${article.title}${article.reading ? ` (${article.reading})` : ""}とは【${site.site.name}】`;
const metaDescription = plainText(article.summary || site.site.description || "");
const searchIndexJSON = JSON.stringify(searchIndex).replaceAll("<", "\\u003c");

const page = `<!doctype html>
<html lang="${attr(site.site.lang || "ja")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(pageTitle)}</title>
  <meta name="description" content="${attr(metaDescription)}">
  <meta name="theme-color" content="${attr(site.site.themeColor || "#314e6f")}">
  <meta name="color-scheme" content="light">
  <meta name="robots" content="noindex, nofollow, noarchive, noimageindex">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${attr(article.title)}">
  <meta property="og:description" content="${attr(metaDescription)}">
  <meta property="og:image" content="${attr(hero.src || "")}">
  <meta property="og:site_name" content="${attr(site.site.name)}">
  <link rel="icon" href="${attr(site.site.mark)}" type="image/svg+xml">
  <link rel="stylesheet" href="assets/css/style.css">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": ${JSON.stringify(article.title)},
    "description": ${JSON.stringify(metaDescription)},
    "dateModified": ${JSON.stringify(article.updated || "")},
    "isPartOf": {
      "@type": "WebSite",
      "name": ${JSON.stringify(site.site.name)}
    }
  }
  </script>
</head>
<body data-article-title="${attr(article.title)}">
  <a class="skip-link" href="#article-name">本文へスキップ</a>

  ${site.notice?.enabled ? `<div class="parody-notice" data-notice data-storage-key="${attr(site.notice.storageKey || "pixpedia-parody-notice")}">
    <p>${esc(site.notice.text || "")}</p>
    <button type="button" class="parody-notice__close" data-notice-close>${esc(site.notice.button || "了解")}</button>
  </div>` : ""}

  <header class="site-header" id="site-header">
    <div class="site-header__inner">
      <div class="site-header__left">
        <button type="button" class="icon-button menu-open" data-open-menu aria-label="${attr(site.header.menuLabel || "メニューを開く")}" aria-controls="drawer-overlay" aria-expanded="false">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <a class="brand" href="#top" aria-label="${attr(`${site.site.name}（パロディ）`)}">
          <img class="brand__mark" src="${attr(site.site.mark)}" alt="" width="32" height="32">
          <span class="brand__name">${esc(site.site.name)}</span>
          <span class="brand__badge">${esc(site.site.badge || "PARODY")}</span>
        </a>
      </div>

      <form class="search" id="site-search" role="search" action="index.html" method="get" autocomplete="off">
        <label class="sr-only" for="search-input">${esc(site.header.searchLabel || "サイト内を検索")}</label>
        <div class="search__field">
          <svg class="search__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="search-input" class="search__input" type="search" name="q" placeholder="${attr(site.header.searchPlaceholder || "けんさく...")}" aria-label="${attr(site.header.searchLabel || "サイト内を検索")}" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false" spellcheck="false">
          <kbd class="search__key" aria-hidden="true">/</kbd>
        </div>
        <div class="search__results" id="search-results" role="listbox" aria-label="検索結果" hidden></div>
      </form>

      <div class="site-header__right">
        <a class="button button--white header-submit" href="${attr(safeHref(site.header.submitHref || "editor.html"))}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke="currentColor" stroke-width="2"/></svg>
          <span class="header-submit__long">${esc(site.header.submitLabel || "記事を投稿")}</span>
          <span class="header-submit__short">投稿</span>
        </a>
        <button type="button" class="button button--blue" data-action="login" data-message="${attr(site.header.loginMessage || "")}">${esc(site.header.loginLabel || "登録/ログイン")}</button>
      </div>
    </div>
  </header>

  ${renderSpotlight()}

  <main class="page" id="main">
    <nav class="breadcrumb" aria-label="パンくずリスト">${renderBreadcrumb()}</nav>

    <div class="layout">
      <article class="article" id="top">
        <header class="article-head">
          <figure class="hero">
            <a class="hero__link" href="${attr(safeHref(hero.creditHref || "#about"))}" aria-label="${attr(hero.caption || hero.alt || "記事画像")}">
              <img class="hero__image" src="${attr(hero.src || "")}" alt="${attr(hero.alt || "")}" width="240" height="240" fetchpriority="high">
              <span class="hero__overlay">
                <span class="hero__caption">${esc(hero.caption || "")}</span>
                ${hero.credit ? `<span class="hero__credit">by ${esc(hero.credit)}</span>` : ""}
              </span>
            </a>
          </figure>

          <div class="article-head__main">
            <ul class="article-categories" aria-label="この記事のカテゴリ">${renderArticleCategories()}</ul>
            <div class="title-row">
              <h1 class="article-title" id="article-name">${esc(article.title)}</h1>
              <button type="button" class="bookmark" data-action="bookmark" aria-pressed="false" aria-label="この記事を保存">
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                <span class="bookmark__label">保存</span>
              </button>
            </div>
            <p class="article-reading">${esc(article.reading || "")}</p>
            <p class="article-summary">${inline(article.summary || "")}</p>
            <ul class="article-actions">${renderArticleActions()}</ul>
          </div>
        </header>

        <div class="article-meta">
          <span>最終更新：${esc(article.updated || "—")}</span>
          <span class="article-meta__sep" aria-hidden="true">・</span>
          <span>ver. ${esc(article.version || "1.0")}</span>
          <span class="article-meta__sep" aria-hidden="true">・</span>
          <button type="button" class="text-button" data-action="history">編集履歴</button>
          <span class="article-meta__spacer"></span>
          <span class="parody-pill">非公式パロディ</span>
        </div>

        <details class="toc" open>
          <summary><span>目次</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
          <ol class="toc__list">
            ${renderToc()}
            <li class="toc__item toc__item--extra"><a href="#categories"><span class="toc__num">＋</span><span>カテゴリ一覧</span></a></li>
          </ol>
        </details>

        <div class="article-body">
          ${tocEntries.map(renderSection).join("\n")}
        </div>

        <section class="categories" id="categories" aria-labelledby="categories-title">
          <div class="section__heading">
            <h2 class="section__title" id="categories-title">${esc(categories.title || "カテゴリ一覧")}<a class="section__anchor" href="#categories" aria-label="カテゴリ一覧へのリンク">#</a></h2>
            <span class="section__rule" aria-hidden="true"></span>
          </div>
          <p class="categories__lead">全${categories.groups.length}カテゴリ / ${totalItems}項目（延べ、ユニーク${uniqueItems}項目）。${esc(categories.description || "")}</p>
          <div class="category-grid">${renderCategoryCards()}</div>
        </section>

        <section class="about" id="about" aria-labelledby="about-title">
          <div class="section__heading">
            <h2 class="section__title" id="about-title">${esc(article.about?.title || "このサイトについて")}<a class="section__anchor" href="#about" aria-label="このサイトについてへのリンク">#</a></h2>
            <span class="section__rule" aria-hidden="true"></span>
          </div>
          <p>${inline(article.about?.text || "", article.linkTerms)}</p>
          <p class="about__links">
            <a href="https://dic.pixiv.net/a/C%E8%A8%80%E8%AA%9E" target="_blank" rel="noopener noreferrer">参考にしたページ（pixiv百科事典「C言語」）</a>
            <span aria-hidden="true">・</span>
            <a href="guide.html#data-structure">編集データはJSON</a>
            <span aria-hidden="true">・</span>
            <span>取得日 2026-10-25</span>
          </p>
        </section>
      </article>

      <aside class="sidebar" aria-label="補助情報">
        <section class="side-card">
          <div class="side-card__head">
            <h2>カテゴリ一覧</h2>
            <span class="side-card__badge">${categories.groups.length}</span>
          </div>
          <p class="side-card__note">全${totalItems}項目（延べ）</p>
          <ul class="side-categories">${renderSidebarCategories()}</ul>
          <a class="side-card__more" href="#categories">カテゴリ一覧をすべて見る <span aria-hidden="true">›</span></a>
        </section>

        <section class="side-card">
          <div class="side-card__head"><h2>この記事のデータ</h2></div>
          <dl class="article-stats">
            <div><dt>セクション</dt><dd>${tocEntries.length}</dd></div>
            <div><dt>本文ブロック</dt><dd>${totalBlocks}</dd></div>
            <div><dt>カテゴリ</dt><dd>${categories.groups.length}</dd></div>
            <div><dt>収録項目</dt><dd>${totalItems}</dd></div>
            <div><dt>関連タグ</dt><dd>${tags.length}</dd></div>
            <div><dt>最終更新</dt><dd>${esc(article.updated || "—")}</dd></div>
          </dl>
          <p class="side-card__note side-card__note--tiny">項目数は content/categories.json から自動計算しています。</p>
        </section>

        <section class="side-card side-card--edit">
          <div class="side-card__head"><h2>この記事を編集</h2></div>
          <p>本文・画像・カテゴリ・項目数はJSONで管理しています。エディタから書き換えて、ビルドし直すだけ。</p>
          <a class="button button--blue button--wide" href="editor.html">コンテンツエディタを開く</a>
          <a class="side-card__text-link" href="guide.html">編集ガイドを読む <span aria-hidden="true">›</span></a>
        </section>
      </aside>
    </div>
  </main>

  ${renderFooter()}

  <button type="button" class="back-to-top" id="back-to-top" aria-label="ページ先頭へ">↑</button>
  ${renderMobileMenu()}
  ${renderHistoryDialog()}

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script type="application/json" id="search-index">${searchIndexJSON}</script>
  <script src="assets/js/main.js" defer></script>
</body>
</html>
`;

await writeFile(path.join(ROOT, "index.html"), page, "utf8");

if (warnings.length) {
  console.warn("\n⚠  警告");
  for (const warning of warnings) console.warn(`   - ${warning}`);
}

console.log(`✓ index.html を生成しました`);
console.log(`  記事: ${article.title} / セクション: ${tocEntries.length} / ブロック: ${totalBlocks}`);
console.log(`  カテゴリ: ${categories.groups.length} / 項目: ${totalItems}（ユニーク ${uniqueItems}） / タグ: ${tags.length}`);
if (warnings.length) console.log(`  警告: ${warnings.length}件`);
