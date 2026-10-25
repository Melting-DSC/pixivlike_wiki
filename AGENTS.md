# AGENTS.md

依存パッケージなしの Node.js 静的サイト。単一の日本語パロディ百科事典記事を JSON から生成する。UI 文言とコンテンツはすべて日本語なので、そのまま日本語で保つ。

## 編集時の注意点
- AGENTS.mdをはじめとした仕様とコード記述内容が食い違う場合は、無理に仕様に合わせてコードを変更せずに既存のコードを優先する。
- その後、作業終了時に仕様とコードが食い違う箇所を列挙し、変更の可否をユーザに判断させる。
- ユーザーから明示的に指示されない限り、コミット・amend・履歴の書き換え・push を行わない。変更後は差分を提示し、確認を待つ。

## コマンド

- `npm run dev` — <http://localhost:4173> でサーバー起動（記事 `/`、エディタ `/editor.html`、ガイド `/guide.html`）。`content/*.json` を監視して自動ビルドする。ポート変更は `PORT=8080 npm run dev`。
- `npm run build` — `index.html` を1回だけ再生成する。これが唯一の検証手順。テスト・lint・型チェック・依存パッケージ・lockfile はない。`npm install` は実行しない。
- `npm run preview` — `--no-watch` 付きの同じサーバー（ファイル監視なし、自動ビルドなし）。

Node.js 18 以上が必要。

## 正となる情報源

- `content/site.json`、`content/article.json`、`content/categories.json` — ページのデータと文言のすべて。**1記事のみ**のサイトであり、複数記事ジェネレーターではない。
- `scripts/build.mjs` — HTML テンプレート全体、コンテンツ検証、計算処理を含む。`index.html` は生成物なので直接編集しない。コンテンツ変更時は再ビルドして一緒にコミットする（同期していれば `npm run build` 後も差分は出ない）。
- `editor.html`、`guide.html`、`assets/css/{editor,guide}.css` — 手書き。生成物ではない。
- `reference/` — ローカルの調査用スナップショット。`reference/*` で gitignore 済み。ビルドや配布物に含めない。

## ビルド時の検証とクセ

- 非ゼロ終了になる条件: `site.name`、`article.title` / `article.sections`、`categories.groups` の欠落、section / category id の重複、ローカルの hero / figure 画像ファイルの欠落。
- 警告のみ（終了コードは 0）: 未知の block `type`、`article.linkTerms` にない `[[term]]`、`2` / `3` 以外の section `level`、対応するグループがない記事カテゴリ。
- ローカル画像パスはリポジトリルート基準で確認される。`https://` と `data:` URL は対象外。
- `safeHref()` が許可するのは `#`、`/`、相対パス、`http(s)://`、`mailto:` のみ。それ以外のスキームは `#` になる。未知の block type は HTML コメントとして出力される。
- section id がない場合はメモリ上で `section-N` が自動割り当てされるが、**ファイルには書き戻されない**。メニュー・フッター・パンくずのリンクが id に直書きされているため、安定した id を使う。
- 節番号、ブロック数、カテゴリ数、項目数、タグ数、検索インデックスはビルド時に計算される。ハードコードしない。
- 一部の表示文言・リンクは JSON ではなく `scripts/build.mjs` に直書きされている: about セクションの pixiv 参考 URL と取得日、フッターの英語版「準備中」メッセージ、モバイルドロワーの CTA リンク。

## エディタと開発サーバー

- エディタの保存（`POST /api/save`）は `npm run dev` 経由でのみ動作する。`file://` や静的ホスティングでは失敗する。
- 保存は3つの JSON を書き込み、再ビルドする。検証またはビルドに失敗した場合は3ファイルすべてをロールバックする（`422`）。`POST /api/build` はコンテンツを変更せず再ビルドする。
- サーバーは再ビルドを 220 ms でデバウンスし、エディタからの保存中は監視を抑止する。`npm run dev` 実行中に JSON を直接編集すると自動で再ビルドされる。

## コンテンツ編集

- JSON は2スペースインデント、UTF-8、コメントなし、末尾改行あり（エディタはこの形式で書き込む）。
- インライン記法: `[[term]]`、`[[term|label]]`、`[label](url)`、`**bold**`、`` `code` ``。
- ブロック種別: `paragraph`、`list`、`code`、`callout`（`info` / `warn` / `parody`）、`tags`、`figure`、`quote`、`divider`。
- スキーマの詳細は `README.md` と `guide.html` に重複して記載されている。ブロック種別やフィールドを追加する場合は、`scripts/build.mjs` の `renderBlock()`、エディタ（`assets/js/editor.js` の `BLOCK_TYPES` とフォーム項目、および `editor.html`）、両方のドキュメントを更新する。
