#!/usr/bin/env node
/* ==========================================================================
   Content checker for the client-side encyclopedia.

   The article page is rendered in the browser from content/*.json, so this
   script no longer generates index.html. It validates the JSON files and
   checks that local images exist, then prints a short summary.

   Run with `npm run build` (or `npm run check`).
   ========================================================================== */

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "content");
const warnings = [];

const readJSON = async (file) => JSON.parse(await readFile(path.join(CONTENT, file), "utf8"));
const isExternal = (value = "") => /^https?:\/\//i.test(String(value));

function fail(message) {
  throw new Error(message);
}

function validateArticle(article) {
  if (!article?.title) fail("content/article.json: title は必須です");
  if (!Array.isArray(article.sections)) fail("content/article.json: sections は配列で指定してください");

  const ids = new Set();
  for (const [index, section] of article.sections.entries()) {
    const id = String(section.id || "").trim() || `section-${index + 1}`;
    if (ids.has(id)) fail(`section id が重複しています: ${id}`);
    ids.add(id);
    if (!section.id) warnings.push(`sections[${index}] に id がありません（${id} として扱います）`);
    if (!section.title) fail(`sections[${index}].title は必須です`);
    if (![2, 3].includes(Number(section.level))) {
      warnings.push(`section「${section.title}」の level は 2 か 3 を推奨します`);
    }
    if (!Array.isArray(section.blocks)) warnings.push(`section「${section.title}」の blocks がありません`);
  }
}

function validateCategories(categories) {
  if (!Array.isArray(categories?.groups)) fail("content/categories.json: groups は配列で指定してください");

  const ids = new Set();
  for (const [index, group] of categories.groups.entries()) {
    const id = String(group.id || "").trim() || `category-${index + 1}`;
    if (ids.has(id)) fail(`category id が重複しています: ${id}`);
    ids.add(id);
    if (!group.name) fail(`categories.groups[${index}].name は必須です`);
    if (!Array.isArray(group.items)) warnings.push(`カテゴリ「${group.name}」の items がありません`);
    for (const item of group.items || []) {
      if (!item.name) fail(`カテゴリ「${group.name}」に名前のない項目があります`);
    }
  }
}

function validateSite(site) {
  if (!site?.site?.name) fail("content/site.json: site.name は必須です");
}

async function checkLocalAsset(src, label) {
  if (!src || isExternal(src) || String(src).startsWith("data:")) return;
  const clean = String(src).split(/[?#]/)[0].replace(/^\.?\//, "");
  try {
    await access(path.join(ROOT, clean));
  } catch {
    fail(`${label} の画像が見つかりません: ${src}`);
  }
}

function scanLinkTerms(text, linkTerms, label) {
  if (typeof text !== "string") return;
  for (const match of text.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)) {
    const term = match[1];
    if (!Object.hasOwn(linkTerms || {}, term)) {
      warnings.push(`linkTerms に「${term}」がありません（${label}）`);
    }
  }
}

function scanBlocks(section) {
  const linkTerms = article.linkTerms || {};
  for (const [index, block] of (section.blocks || []).entries()) {
    const label = `section「${section.title}」blocks[${index}]`;
    switch (block.type) {
      case "paragraph":
        scanLinkTerms(block.text, linkTerms, label);
        break;
      case "list":
        scanLinkTerms(block.title, linkTerms, label);
        for (const item of block.items || []) scanLinkTerms(item, linkTerms, label);
        break;
      case "callout":
        scanLinkTerms(block.title, linkTerms, label);
        scanLinkTerms(block.text, linkTerms, label);
        break;
      case "quote":
        scanLinkTerms(block.text, linkTerms, label);
        break;
      case "figure":
        scanLinkTerms(block.caption, linkTerms, label);
        break;
      case "code":
      case "tags":
      case "divider":
        break;
      default:
        warnings.push(`未対応の block type「${block.type}」（${label}）`);
    }
  }
}

const site = await readJSON("site.json");
const article = await readJSON("article.json");
const categories = await readJSON("categories.json");

validateSite(site);
validateArticle(article);
validateCategories(categories);

const groupNames = new Set(categories.groups.map((group) => group.name));
for (const name of article.categories || []) {
  if (!groupNames.has(name)) {
    warnings.push(`記事のカテゴリ「${name}」に対応するグループが categories.json にありません`);
  }
}

await checkLocalAsset(article.hero?.src, "hero");
for (const section of article.sections) {
  scanBlocks(section);
  for (const [index, block] of (section.blocks || []).entries()) {
    if (block.type === "figure") {
      await checkLocalAsset(block.src, `figure (${section.title} blocks[${index}])`);
    }
  }
}

const totalBlocks = article.sections.reduce((sum, section) => sum + (section.blocks?.length || 0), 0);
const totalItems = categories.groups.reduce((sum, group) => sum + (group.items?.length || 0), 0);
const uniqueItems = new Set(categories.groups.flatMap((group) => (group.items || []).map((item) => item.name))).size;
const tags = article.relatedTags || [];

if (warnings.length) {
  console.warn("\n⚠  警告");
  for (const warning of [...new Set(warnings)]) console.warn(`   - ${warning}`);
}

console.log("✓ コンテンツを検証しました（記事はブラウザで描画されます）");
console.log(`  記事: ${article.title} / セクション: ${article.sections.length} / ブロック: ${totalBlocks}`);
console.log(`  カテゴリ: ${categories.groups.length} / 項目: ${totalItems}（ユニーク ${uniqueItems}） / タグ: ${tags.length}`);
if (warnings.length) console.log(`  警告: ${new Set(warnings).size}件`);
