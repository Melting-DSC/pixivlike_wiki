# うちのこ百科事典（C言語）

ピクシブ百科事典の記事ページを参考にした、C言語の非公式パロディ百科事典です。
記事はブラウザで `content/*.json` から組み立てます。サーバー側の保存処理やビルド生成はなく、
編集・保存・書き出しはすべてクライアントサイドで完結します。

- 記事ページ + 編集モード: `index.html`
- 使い方（サイト内）: `guide.html`
- 旧エディタURL: `editor.html`（`index.html#editor` へ転送）

> このサイトはpixiv株式会社、ピクシブ百科事典、および記事内で言及される各団体・人物とは関係のない非公式パロディです。

## クイックスタート

Node.js 18以降が必要です。外部パッケージのインストールは不要です。

```bash
npm run dev
```

- 記事: <http://localhost:4173/>
- 編集モード: <http://localhost:4173/index.html#editor>
- 使い方: <http://localhost:4173/guide.html>

| コマンド | 動作 |
| --- | --- |
| `npm run dev` | 静的ファイルを配信 |
| `npm run build` | `content/*.json` を検証（HTMLは生成しない） |
| `npm run check` | `npm run build` と同じ |
| `npm start` | `npm run dev` と同じ |
| `npm run preview` | `npm run dev` と同じ静的配信 |

`PORT` 環境変数でポートを変更できます。

```bash
PORT=8080 npm run dev
```

`file://` で開くと `content/*.json` の `fetch` が失敗します。ローカル確認は `npm run dev` を使ってください。
静的ホスティング上ではそのまま動作します。

## ファイル構成

```text
.
├── index.html              # 記事シェル + 編集モード（手書き。生成物ではない）
├── editor.html             # 旧URL。index.html#editor へリダイレクト
├── guide.html              # サイト利用者向けの使い方
├── robots.txt              # 検索エンジンのクロール拒否
├── content/
│   ├── site.json           # サイト名・ヘッダー・フッター・メニュー
│   └── article.json        # 記事本文・画像・タグ・履歴
├── assets/
│   ├── css/style.css       # 記事ページとHTML書き出しのスタイル
│   ├── css/editor.css      # 編集モードのスタイル
│   ├── css/guide.css       # 使い方ページのスタイル
│   ├── js/render.js        # 記事・検索インデックス・HTML書き出しのレンダラー
│   ├── js/store.js         # content読込・localStorage・検証
│   ├── js/main.js          # 記事の初期化、検索・ドロワー・ダイアログ
│   ├── js/editor.js        # 編集モードの状態管理・自動保存・画像
│   ├── js/exporter.js      # JSON / HTML / PNG / PDF 書き出し
│   └── images/             # ロゴと挿絵（オリジナルSVG）
├── scripts/
│   ├── build.mjs           # 依存なしのコンテンツ検証スクリプト
│   └── serve.mjs           # 依存なしの静的開発サーバー
├── reference/              # 参考にしたページの保存資料（gitignore）
└── package.json
```

`index.html` は手書きのシェルです。記事部分は `assets/js/render.js` が実行時に生成します。
`scripts/build.mjs` は `index.html` を書き換えません。

## アーキテクチャ

1. `assets/js/store.js` が `content/site.json`、`content/article.json` を `fetch` する。
2. `localStorage` に保存済みの編集内容があれば、既定データへ深くマージする。
3. `assets/js/render.js` が記事HTMLと検索インデックスを生成し、`assets/js/main.js` が `#site-root` へ描画する。
4. 編集モードは `index.html` 内の `#editor-overlay` にあり、ページ移動せずに開閉する。
5. 編集内容は `localStorage` に自動保存され、閉じると記事が再描画される。

グローバルに公開しているオブジェクト:

| オブジェクト | 役割 |
| --- | --- |
| `WikiStore` | 読込、保存、削除、検証、画像 data URL の除去 |
| `WikiRender` | 記事・検索インデックス・HTML書き出し |
| `WikiExport` | JSON / HTML / PNG / PDF の生成とダウンロード |
| `WikiSite` | 記事の初期化、再描画、編集モード起動 |
| `WikiEditor` | 編集モードの開閉 |

### localStorage

| キー | 内容 |
| --- | --- |
| `uchinoko-wiki:content:v1` | `{ site, article }` をまとめた編集内容 |
| `uchinoko-wiki:content:v1:savedAt` | 最終保存日時（ISO 8601） |

- 保存は `WikiStore.save()` が行い、画像の `data:` URL は保存前に空文字へ置換します。
- 保存に失敗した場合（容量不足など）は編集モードにエラーを表示します。JSONの書き出しを促してください。
- 初期データに戻すと、この2つのキーを削除して `content/*.json` を読み直します。
- 記事のブックマークや注意バーの閉じ状態は別キーです（`pixpedia-parody-*`）。

### 画像の扱い

- 編集モードの画像アップロードは `FileReader` で data URL にし、その場で記事へ表示します。
- `localStorage` には画像を保存しません。再訪時は空文字になり、編集モードで再選択を促します。
- `article.hero.src` と `figure` ブロックの `src` が対象です。
- 画像パスに `assets/images/...` や `https://...` を直接指定した場合は、その参照を保存します。
- HTML / PNG / PDF の書き出し時は、画像を data URL に変換して埋め込みます。CORS で取得できない外部画像は絶対URLのまま残ります。

### 書き出し

| 形式 | 実装 | 内容 |
| --- | --- | --- |
| JSON | `WikiExport.exportJSON` | `{ format, version, exportedAt, site, article }` の1ファイル |
| HTML | `WikiExport.exportHTML` | `style.css` と画像を埋め込んだ単体HTML |
| PNG | `WikiExport.exportPNG` | 記事全体のキャプチャ |
| PDF | `WikiExport.exportPDF` | PNGと同じキャプチャをJPEG化し、A4複数ページへ分割 |

- PNG / PDF は SVG `foreignObject` を canvas に描画する方式です。外部フォントやCORS画像の扱いはブラウザ依存です。
- canvas の上限（16384px）を超える長い記事では、自動的に縮小されます。
- PDF は依存ライブラリを使わず、JPEG画像を貼る最小構成のPDFを組み立てます。テキスト選択はできません。
- ファイル名は `uchinoko-<記事タイトル>-<YYYY-MM-DD>.<拡張子>` です。

### 読み込み

「書き出し」パネルの `#import-files` は次の両方を受け付けます。

- 本サイトが書き出したJSONバンドル（`site` / `article` を持つもの。旧形式の `categories` は無視）
- `site.json`、`article.json` の個別ファイル（複数選択可）

読み込んだ内容は検証後に `localStorage` へ保存され、記事へ即時反映されます。
読み込み前の内容は自動では退避されません。必要なら先にJSONを書き出してください。

## データ構造

2ファイルはすべてUTF-8のJSONです。コメントは書けません。

### `content/article.json`

| キー | 型 | 内容 |
| --- | --- | --- |
| `title` | string | 記事タイトル（必須） |
| `reading` | string | 読み。ページタイトルに表示 |
| `summary` | string | 冒頭の説明。meta descriptionにも使用 |
| `breadcrumb` | array | `{ label, href? }` の配列。カテゴリ系の href はリンクにしない。編集モードでは編集不可 |
| `hero` | object | `src`, `alt`, `caption`, `credit`。画像は押しても移動しない空リンク |
| `actions` | array | `{ label, primary? }`。タイトル下のリンク。押しても移動しない空リンク |
| `updated` | string | 最終更新日（`YYYY-MM-DD`） |
| `version` | string | バージョン表記 |
| `sections` | array | 本文セクション（必須） |
| `relatedTags` | string[] | 関連タグ |
| `history` | array | `{ date, note }` の配列。編集モードでは編集不可 |
| `about` | object | `{ title, text }` |

セクションの構造:

```json
{
  "id": "overview",
  "level": 2,
  "title": "概要",
  "blocks": [
    { "type": "paragraph", "text": "本文です。" }
  ]
}
```

- `id` は目次アンカー。ファイル内で一意にします。未指定時は `section-N` として扱いますが、保存はされません。
- `level` は `2`（大見出し）または `3`（小見出し）を推奨。
- `title` は必須。
- `blocks` は配列。省略時は空として扱われます。

### `content/site.json`

| キー | 内容 |
| --- | --- |
| `site` | `name`, `badge`, `mark`, `tagline`, `description`, `lang`, `themeColor` |
| `notice` | 上部の注意バー。`enabled`, `text`, `button`, `storageKey` |
| `header` | 検索プレースホルダー、編集ボタン、ログインボタンの文言とリンク |
| `footer` | `disclaimer`。フッターにはロゴと免責事項のみを表示 |
| `menu` | モバイルドロワーの `title` と `sections` |

`site.json` は編集モードからは編集できません。変更する場合はファイルを直接書き換えます。

## 本文ブロック

| `type` | 主なキー | 表示 |
| --- | --- | --- |
| `paragraph` | `text` | 段落 |
| `list` | `title?`, `items[]`, `ordered?` | 箇条書き。`ordered: true` で番号付き |
| `code` | `language`, `filename`, `code` | コピー付きコードブロック |
| `callout` | `tone`, `title?`, `text` | 注記。`tone` は `info` / `warn` / `parody` |
| `tags` | `items[]` | 検索できるタグクラウド |
| `figure` | `src`, `alt`, `caption`, `credit?` | 画像とキャプション。`src` が空なら未設定表示 |
| `quote` | `text`, `cite?` | 引用 |
| `divider` | なし | 区切り線 |

未対応の `type` は検証時に警告され、記事には何も描画されません。

### インライン記法

段落、リスト、注記、引用、キャプションで使用できます。

| 書き方 | 結果 |
| --- | --- |
| `[[C++]]` | 「C++」をリンクと同じ見た目の平文で表示（押しても移動しない） |
| `[[C++\|Cプラプラ]]` | 表示名を変えて同様に表示 |
| `[ラベル](https://example.com)` | 通常のリンク。外部URLは新しいタブ |
| `**強調**` | 太字 |
| `` `コード` `` | インラインコード |

- URLは `WikiRender.safeHref()` で検証されます。`javascript:` などは `#` に置き換わります。
- HTMLタグはエスケープされ、そのままでは埋め込まれません。
- コードブロック内の `code` にはインライン記法を適用しません。
- パンくず・モバイルメニューの `#categories` や `#category-*` へのリンクは、カテゴリ機能削除に伴いリンクにせず平文にします。

## 検証

`npm run build`（または `npm run check`）は `scripts/build.mjs` を実行し、次を確認します。

- `site.site.name`、`article.title`、`article.sections` の存在
- セクションIDの重複
- セクション名の欠落
- ローカルのヒーロー画像・`figure` 画像ファイルの存在
- 未知のブロック種別
- `2` / `3` 以外の section `level`

ローカル画像パスはリポジトリルート基準です。`https://` と `data:` URL は存在チェックの対象外です。
検証は警告のみで終了コード 0 になる項目もあります。ビルドはHTMLを生成しません。

## 静的ホスティング

次のファイルをアップロードします。

```text
index.html
guide.html
editor.html
robots.txt
assets/
content/
```

`content/` は記事の初期データとしてブラウザが読み込みます。編集モードを使わない場合でも、
初回表示に必要です。`editor.html` は旧リンク互換のためだけに残しています。

GitHub Pages などの静的ホスティングでは、保存は各閲覧者のブラウザ内に限定されます。
公開記事を更新したい場合は、編集モードでJSONを書き出し、リポジトリの `content/` を更新してから
再度アップロードしてください（`npm run build` は検証のみです）。

## 検索避け

このサイトは公開状態でも検索エンジンに登録されないよう、次の2つを設定しています。

- `index.html`、`guide.html`、`editor.html` の `<head>` に
  `<meta name="robots" content="noindex, nofollow, noarchive, noimageindex">` を指定
- リポジトリ直下の `robots.txt` で `Disallow: /`

`robots.txt` はサイトのルートに置かれた場合のみ有効です。GitHub Pages のプロジェクトページ
（`https://example.github.io/repo/`）ではオリジン直下の `robots.txt` が読まれないため、
各ページの `noindex` が主な対策になります。

これらは検索結果への掲載を避けるための設定であり、アクセス制限ではありません。

## 補足・トラブルシューティング

- **記事が表示されない**: `file://` ではなく `npm run dev` か静的ホスティング経由で開いてください。
- **編集内容が消えた**: ブラウザのサイトデータ消去、シークレットウィンドウ、別ブラウザでは保存が共有されません。JSONから復元してください。
- **画像が消えた**: アップロード画像は保存されません。編集モードで再選択するか、固定パスを指定してください。
- **書き出しに失敗する**: 外部画像のCORS、canvasのサイズ上限、メモリ不足が原因になることがあります。JSONでバックアップしてください。
- **検証で失敗する**: エラーメッセージのファイル名・キーを確認してください。必須項目、IDの重複、画像パスが主な原因です。
- **旧エディタを開いた**: `editor.html` は `index.html#editor` へ転送します。

## 参考資料

`reference/` に、参考にしたページの保存資料と出典をまとめています。このディレクトリは
`.gitignore` の対象で、リポジトリや配布物には含まれません。

## ライセンス・免責

このリポジトリの文章・ロゴ・挿絵は、このパロディサイト用に作成したものです。
pixiv百科事典の本文をそのまま転載したものではありません。
pixiv株式会社、ピクシブ百科事典、および記事内で言及される各団体・人物とは関係ありません。
