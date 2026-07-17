# 骨格/データ分離設計 — ノードパックアーキテクチャ

> 対象バージョン: Wend 0.1.x → 0.2 系
> 関連文書: [graph-node-design.md](graph-node-design.md), [node-api-spec.md](node-api-spec.md), [roadmap-and-product.md](roadmap-and-product.md)
> 注: `designdoc/wend-app.md` の Win32/WebView2 に関する記述は旧世代アーキテクチャのものであり、本書は現行 Electron 実装 (`electron/main.js` + `frontend/app.js`) を前提とする。

## 1. 目的

Wend を「安定した骨格(スケルトン)」と「AI が自律的に改善でき、ユーザー間で交換可能な外部定義データ」に明確に分離する。

現状の分離状況:

| 領域 | 現状 | 評価 |
|---|---|---|
| レシピ (provider+model+params プリセット) | `frontend/defaults/recipes-*.json` + `%APPDATA%/Wend/recipes.json` | ✅ データ化済み |
| プロバイダ | `electron/providers/*.js` 自動発見 (`{ProviderClass, metadata}`) + `%APPDATA%/Wend/custom_providers/` スキャン (`main.js` `loadCustomProviders`) | ✅ プラグイン化済み |
| ウィザード / 言語 / サンプル | `frontend/wizards/*.json`, `frontend/lang/*.json`, `sample/**/*.json` | ✅ データ化済み |
| **ノード定義 (BT アクション)** | `frontend/bt-actions.js` にハードコード (11 アクション + 暗黙の `processPrompt`) | ❌ コード直書き |
| **操作ペインのフィールド表示** | `app.js` の `_getActionFields` + 固定 DOM グループ (`#bt-prompt-fields` 等) | ❌ コード直書き |
| ノードのパラメータ格納 | `btLocalFilePath` / `btManualMode` / `btWorkingDir` 等、アクションごとにアドホックなトップレベルフィールド | ❌ スキーマなし |

本設計は ❌ の3点を「**ノードパック**」という宣言的 JSON フォーマットに置き換える。

## 2. 分離原則

> **「何を実行するか」= データ。「実行の仕組み」= コード(骨格)。**

- DOM・ファイルシステム・ネットワークに直接触れる処理は骨格(またはパック同梱の信頼済みモジュール)に残す。
- 「プロバイダ X をテンプレート Y で呼び、ポート Z にマップする」と表現できるものはすべてデータにする。

### 2.1 骨格に残すもの(安定 API として維持)

| 責務 | 場所 |
|---|---|
| BT 実行セマンティクス (composite/decorator/run-state/step/pause) | `frontend/bt.js` (`BehaviorTreeEngine`) |
| Blackboard ストア・スコープ解決・`{bb:key}` プレースホルダ展開 | `frontend/bt.js` |
| ノードレジストリランタイム + ctx 構築 + パラメータ解決 | `frontend/bt-registry.js` → `WendNodes` へ発展 ([node-api-spec.md](node-api-spec.md)) |
| パラメータ記述子 → ウィジェットの自動 UI レンダラ | 新規 `frontend/op-pane.js` |
| プリミティブ演算インタープリタ (§5 の `pipeline` 種) | 新規 `frontend/node-ops.js` |
| プロバイダ実行クラス(ネットワーク/API コード) | `electron/providers/*.js` |
| Storage / IPC / HTTP API / MCP トランスポート | `electron/main.js` (将来分割、roadmap 参照) |
| ツリーレンダラ・ペイン・ダイアログ・i18n ランタイム | `frontend/app.js` |

### 2.2 外部データ化するもの

- **ノードパック**(新規、本書の主題): ノードのメタデータ・ポート宣言・パラメータ記述子・デフォルト値・プロンプトテンプレート・宣言的な振る舞い合成。
- レシピ(既存): パックから名前参照される。
- パイプラインテンプレート: `sample/**/radio.json` 形式を第一級の共有単位に昇格(`.wendpack` 同梱可、roadmap 参照)。

## 3. ノードパック JSON スキーマ

配置: 同梱パックは `frontend/nodepacks/*.json`、ユーザーパックは `%APPDATA%/Wend/nodepacks/<パック名>/pack.json`。
検証: `frontend/schemas/nodepack.schema.json` (JSON Schema draft-07 以降)。

```jsonc
{
  "packFormat": 1,                      // フォーマットバージョン(整数)。骨格が理解できない値は読込拒否
  "id": "wend.core",                    // 逆ドメイン風の一意 ID
  "version": "1.0.0",                   // semver
  "label": { "en": "Wend Core Nodes", "ja": "Wend コアノード" },
  "author": "wend",
  "license": "GPL-3.0",
  "requires": {
    "app": ">=0.2.0",                   // アプリ最低バージョン
    "packs": {}                          // 依存パック { "id": ">=x.y.z" }
  },
  "nodes": [
    {
      "type": "wend.core.loadLocalFile", // グローバル一意なノード型名(<packId>.<name>)
      "label": { "en": "Load Local File", "ja": "ローカルファイル読込" },
      "category": "io",                  // io | media | ai | logic | transform | ui | misc
      "icon": "📂",
      "description": { "en": "...", "ja": "..." },
      "ports": {
        "in":  [],
        "out": [ { "name": "content", "type": "media", "bbDefault": true } ]
      },
      "params": [
        {
          "name": "filePath",
          "type": "filepath",
          "required": true,
          "default": "",
          "ui": { "widget": "file", "label": { "en": "File Path", "ja": "ファイルパス" },
                  "hint": { "en": "Relative to project" }, "browse": true }
        },
        {
          "name": "outputType",
          "type": "enum", "options": ["media", "text"], "default": "media",
          "ui": { "widget": "select" }
        }
      ],
      "impl": { "kind": "builtin", "handler": "loadLocalFile" },
      "compat": {
        "btAction": "loadLocalFile",
        "paramMap": { "filePath": "btLocalFilePath" }
      }
    }
  ]
}
```

### 3.1 スキーマの要点

- **`ports`**: 型付き入出力宣言。型システムは [graph-node-design.md](graph-node-design.md) §3 で定義(`text` / `number` / `boolean` / `json` / `filepath` / `media` / `media/image` / `media/audio` / `media/video` / `any`)。`bbDefault: true` のポートは、BT リーフとして使われた際に `btOutputKey` / `btInputKey` に接続される既定ポート。
- **`params`**: 操作ペイン UI を自動生成するパラメータ記述子(§4)。
- **`impl`**: 振る舞いの実装方式。4 階層(§5)。
- **`compat`**: 既存ツリーとの後方互換マップ(§6)。

## 4. パラメータ記述子 → ウィジェット自動 UI

現状 `app.js:9600` 前後の `renderPrompt()` は、アクションの `fields` 配列を `_getActionFields` で引き、固定 DOM グループ(`#bt-prompt-fields`, `#bt-input-fields`, `#bt-output-fields`, `#bt-local-file-field`, `#bt-manual-fields`, `#bt-invoke-fields`)の表示/非表示を切り替えるだけで、新フィールド追加のたびに HTML と保存処理 (`saveBtNodeConfig`) の両方に手を入れる必要がある。

これを **記述子駆動レンダラ**(新規 `frontend/op-pane.js`)に置き換える:

| `ui.widget` | 生成される UI | `param.type` の既定対応 |
|---|---|---|
| `text` | 1行テキスト入力 | `text` |
| `textarea` | 複数行テキスト | `text` |
| `prompt` | textarea + `{bb:key}` プレースホルダ補完アシスト | `text` |
| `number` | 数値入力 (min/max/step は `ui` で指定) | `number` |
| `slider` | スライダ + 数値表示 | `number` |
| `select` | ドロップダウン (`options` から) | `enum` |
| `checkbox` | チェックボックス | `boolean` |
| `file` | パス入力 + 参照ボタン(既存ファイルダイアログ IPC 再利用) | `filepath` |
| `bbkey` | Blackboard キー入力 + 現在キーのオートコンプリート | `text` |
| `json` | 等幅 textarea + blur 時 JSON 検証 | `json` |
| `choices` | 構造化リストエディタ(生 JSON の `btManualChoices` を置換) | `json` |

- パラメータ値は `node.btParams = { <name>: <value> }` の単一バッグに集約する。
- レンダラは `compat.paramMap` を参照し、レガシーフィールド(`btLocalFilePath` 等)との読み書き変換を行う。既存ツリーはバイト単位で互換を保つ(§6)。
- レガシーの固定 DOM グループは、パック未定義のフィールド(`btType` 選択・レシピ選択など BT 構造系)についてのみ残す。

## 5. `impl` の 4 階層 — 信頼境界の設計

「何をコードに残すか」への回答。数字が大きいほど自由度が高く、信頼要件も上がる。

### 5.1 `builtin` — 骨格登録済みハンドラ参照

```json
{ "kind": "builtin", "handler": "loadLocalFile" }
```

- コード側 (`WendNodes.registerHandler`) で登録された関数を名前参照。DOM 操作(playAudio/playVideo)や IPC 呼び出しを伴う処理はここ。
- **既存 11 アクションはすべて builtin 種として `frontend/nodepacks/wend.core.json` に再宣言する**(§6 に全対応表)。ハンドラ本体は `bt-actions.js` のまま。

### 5.2 `provider` — 純データ宣言(AI 自律改善の主対象)

```jsonc
{
  "kind": "provider",
  "provider": "comfyui",
  "recipe": "sdxl-base",                       // 任意。レシピ名参照
  "promptTemplate": "masterpiece, {param:style}, {in:subject}",
  "customParams": {
    "workflow": { /* ComfyUI ワークフロー JSON 全体 */ },
    "steps": "{param:steps}"
  },
  "outputPort": "image"
}
```

- 骨格側の**汎用ハンドラ 1 個**が実行する: `promptTemplate` を展開(`{param:name}` = ノードパラメータ、`{in:port}` = 入力ポート値、既存 `{bb:key}` も可)し、今日 `_runAI` / `processPrompt` が組み立てるのと同じプロバイダリクエストを発行する。
- **ComfyUI ブリッジが無償で手に入る**: `electron/providers/comfyui.js` は既に `req.customParams.workflow` の ComfyUI ワークフロー JSON を受理する。つまり provider 種パックに workflow を埋め込むだけで、**任意の ComfyUI ワークフローが配布可能な型付き Wend ノードになる**。
- eval なし・任意コードなしで、**構造的に安全**。MCP 経由で AI が自由に作成・改善してよい階層。

### 5.3 `pipeline` — プリミティブ演算の合成

```jsonc
{
  "kind": "pipeline",
  "steps": [
    { "op": "template", "template": "{in:raw}", "out": "$t" },
    { "op": "regex",    "in": "$t", "pattern": "```json\\n([\\s\\S]*?)```", "group": 1, "out": "$j" },
    { "op": "jsonpath", "in": "$j", "path": "$.title", "out": "$title" },
    { "op": "portWrite", "port": "title", "in": "$title" }
  ]
}
```

- 閉じたプリミティブ演算セットを `frontend/node-ops.js`(新規、インタープリタ)が解釈: `template` / `regex` / `jsonpath` / `math`(既存 `bt-actions.js` の math ホワイトリスト評価器を再利用)/ `http`(`bt_http_request` IPC 経由)/ `bbRead` / `bbWrite` / `portRead` / `portWrite` / `branch`。
- eval なし・DOM/fs アクセスなし。**構造的にサンドボックス**。決定的で、AI 作成可。
- テキスト整形・抽出・簡易分岐という「あと一歩」のニーズを、module 種に頼らず埋めるための階層。

### 5.4 `module` — パック同梱 JS(オプトイン)

```json
{ "kind": "module", "file": "handlers/my-node.js" }
```

- パックディレクトリ相対のファイルを読み込み、`export function handler(ctx)`(または CommonJS `module.exports.handler`)を実行。
- **初回ロード時にユーザー同意ダイアログ必須**:「このパックは実行可能コードを含みます」。同意記録は `%APPDATA%/Wend/config.json` にパック ID + コンテンツハッシュで保存し、更新されたら再同意。
- パックマネージャ UI で ⚠️ バッジ表示。
- ハンドラに渡す ctx は builtin より狭い(raw `app` / `bt` を渡さない — [node-api-spec.md](node-api-spec.md) §3)。
- ComfyUI カスタムノードと同じ「コードは書ける、ただし明示同意」の信頼モデル。

## 6. 後方互換 — 既存 11 アクションの対応表

`wend.core.json` に再宣言する際の `compat.paramMap`。既存ツリーの読み書きはレガシーフィールドをそのまま使用し(保存フォーマット不変)、新レンダラ/エンジンは paramMap 経由で双方向変換する。

| ノード型 (`wend.core.*`) | 旧 `btAction` | パラメータ ← レガシーフィールド |
|---|---|---|
| `loadLocalFile` | `loadLocalFile` | `filePath←btLocalFilePath`, `outputKey←btOutputKey`, `outputType←btOutputType`, `outputScope←btOutputScope` |
| `playAudio` | `playAudio` | `inputKey←btInputKey` |
| `playVideo` | `playVideo` | `inputKey←btInputKey` |
| `pipelineOutput` | `pipelineOutput` | `inputKey←btInputKey` |
| `math` | `math` | `expression←btPrompt(base64)`, `outputKey←btOutputKey`, `outputType←btOutputType` |
| `web` | `web` | `request←btPrompt(base64)`, `outputKey←btOutputKey`, `outputType←btOutputType` |
| `misc` | `misc` | `operation←btPrompt(base64)`, `outputKey←btOutputKey`, `outputType←btOutputType` |
| `mediaToFile` | `mediaToFile` | `inputKey←btInputKey`, `outputKey←btOutputKey` |
| `fileToMedia` | `fileToMedia` | `inputKey←btInputKey`, `outputKey←btOutputKey` |
| `manual` | `manual` | `mode←btManualMode`, `prompt←btManualPrompt(base64)`, `choices←btManualChoices(JSON文字列)`, `outputKey←btOutputKey` |
| `invoke` | `invoke` | `command←btPrompt(base64)`, `workingDir←btWorkingDir`, `inputKey←btInputKey`, `outputKey←btOutputKey` |
| `processPrompt` | (暗黙の既定) | `prompt←btPrompt(base64)`, `recipe←selectedRecipe`, `inputKey/inputType/outputKey/outputType←bt*` |

補足:
- **`processPrompt` の特別扱い解消**: 現在レジストリ未登録で各所に special-case されている既定 AI 呼び出しを、`wend.core.processPrompt`(builtin 種)として正式登録する。`btAction` 未指定 = `processPrompt` という既定は維持。
- base64 エンコード(`btPrompt` / `btManualPrompt` / `title`)はレガシーフィールド側の性質として paramMap 変換層に閉じ込め、`btParams` 内は平文とする。
- `bt.js` `_runLeaf`/`_runAction` に重複する `typeToAction` レガシーマップ(`math`/`file`/`web`/`audio` 等 → アクション名)は、パック解決の前段の単一モジュール定数に統合する。

## 7. 発見・ロード機構

`main.js` の `loadCustomProviders`(`custom_providers/` スキャン)と同一パターンを踏襲する:

```
起動時:
  1. frontend/nodepacks/*.json          (同梱パック)
  2. %APPDATA%/Wend/nodepacks/*/pack.json (ユーザーパック)
  → JSON Schema 検証(不合格パックはスキップ + 警告、他パックに影響させない)
  → requires 解決(アプリ/依存パックのバージョン確認)
  → メインプロセスから renderer へ JSON 送信(パックはデータなので IPC 境界を丸ごと通せる。
    custom_providers と違い renderer 側レジストリに直接登録できる)
  → module 種のみ: 同意記録チェック → 未同意ならダイアログ、拒否ならそのノード型を無効化
実行時:
  IPC メッセージ `reload_node_packs` で再スキャン → 差分再登録。
  実行中のツリーは旧定義のまま完走させる。
```

## 8. AI 自律改善ループ(MCP)

新設 MCP ツール(詳細な API 面は [node-api-spec.md](node-api-spec.md) §4):

- `list_node_packs` — パック一覧(id/version/種別内訳)
- `get_node_pack(id)` — パック JSON 取得
- `validate_node_pack(json)` — スキーマ検証 + lint(未知の provider/recipe 参照、ポート型エラー、未使用パラメータ)
- `save_node_pack(json)` — `%APPDATA%/Wend/nodepacks/` へ書き込み + ホットリロード。**module 種を含むパックは、設定フラグ `allowModulePacksFromMcp` が有効でない限り拒否**

これにより AI エージェントの閉ループが成立する:

```
実行ログ観察 → 失敗ノード特定 → get_node_pack → promptTemplate / pipeline steps を改善
→ validate_node_pack → save_node_pack → run_bt で再検証
```

書き込み面が宣言的データ(provider / pipeline 種)に限定されているため、このループは安全に自動化できる。「AI が自律的にレシピ・ノード定義を改善する」という要件の実装形がこれである。

## 9. 交換フォーマット `.wendpack`

- 実体は zip: `pack.json` + アセット(`handlers/*.js`, アイコン, サンプルツリー `samples/*.json`)。
- アプリ内エクスポート/インポート + 配布チャネル構想は [roadmap-and-product.md](roadmap-and-product.md) §4 を参照。
