# ロードマップとプロダクト戦略

> 関連文書: [core-data-separation.md](core-data-separation.md), [graph-node-design.md](graph-node-design.md), [node-api-spec.md](node-api-spec.md)

## 1. 即修正すべき既知バグ・未完成機能(Phase 1 冒頭)

| # | 問題 | 修正方針 |
|---|---|---|
| 1 | **`invoke` アクションのバックエンド欠如**: `bt_invoke_command` は `frontend/bt-actions.js` から送信されるが、`electron/main.js` に受け手がない(`bt_load_local_file` / `bt_media_to_file` / `bt_http_request` は処理される同じ switch に case がない)→ **Promise が永久未解決で BT 実行がハングする** | main.js に `bt_invoke_command` ハンドラ追加: `child_process.execFile` + タイムアウト + 設定 `allowCommandExecution`(既定 off、初回実行時に確認)。さらに**フロント側にもタイムアウトを追加**し、「応答なし = 永久ハング」という構造自体を排除する |
| 2 | **`filepath` 入力型が UI のみ**: 操作ペインの `<option value="filepath">` は存在するが、`bt.js` `_runAI` は text/media しか分岐せず、filepath は事実上 text 扱い | `_runAI` に filepath 分岐を追加: bb のテキストをパスとして `bt_load_local_file` IPC で解決し media として供給(= 既存 `fileToMedia` と同じ経路)。挙動を defaults_json_guide.md 系のドキュメントに明記 |
| 3 | **`typeToAction` レガシーマップの重複**: `bt.js` の `_runLeaf` と `_runAction` に同一マップが 2 回定義 | モジュールレベル定数 1 箇所に統合 |
| 4 | **パッケージ肥大**: `style.css.bak`、`test-b3-*.html`、`diagnose-b3.html` が配布物に含まれる | ビルド対象から除外 |
| 5 | **BT エンジンの二重化**: 独自 `bt.js` と behavior3js アダプタ層(`bt-b3-*.js`)が併存し、どちらが正か不明瞭 | **`bt.js` を唯一の実行エンジンと宣言**。`bt-b3-*` は入出力コンバータ(相互運用フォーマット)専用と位置付け、README / designdoc に明記。実行系の新機能は bt.js のみに実装 |

## 2. 段階的モジュール分割(バンドラ導入なし)

`frontend/app.js`(13,405 行)と `electron/main.js`(5,374 行)は神オブジェクト。ただし一括リライトはしない — 各ステップが機械的・テスト可能・単独出荷可能な `<script>` / `require` 追加抽出で進める。

| 抽出順 | 抽出先 | 内容 |
|---|---|---|
| app.js → | `op-pane.js` | 操作ペインレンダラ。Phase 1 で自動 UI レンダラに置換するため最初に分離 |
| | `tree-model.js` | getNodeByPath / add / move / delete 等のツリー操作(MCP 粒度 API の実体) |
| | `ipc.js` | postMessage + メッセージリスナーレジストリ |
| | `run-context.js` | processPrompt 実行オーケストレーション |
| main.js → | `storage.js` | Storage クラス |
| | `runner.js` | PipelineRunner / Optimizer |
| | `http-api.js` | port 18765 の BT HTTP API |
| | `bt-bridge.js` | bt_* IPC メッセージハンドラ群 |

各ステップは挙動変更ゼロで、`npm test`(`electron/test.js`)通過を条件とする。

## 3. 5 フェーズロードマップ

全フェーズで既存ツリー完全互換。Phase 1–2 は純粋な追加、Phase 3 は warn-only、Phase 4 は旧ツリーに存在しない新リーフ型のみ。

### Phase 1 — 基盤(小さく、出荷可能)
- §1 のバグ修正(①〜④)+ ⑤の方針文書化
- `frontend/schemas/nodepack.schema.json` + `frontend/nodepacks/wend.core.json`(既存 11 アクション + processPrompt を builtin 種で再宣言、`compat.paramMap` 付き)
- `WendNodes` レジストリ(`btActions` ファサード維持)
- 自動 UI パラメータレンダラ `frontend/op-pane.js`(パック宣言パラメータ用。レガシー DOM グループは BT 構造系フィールド用に残す)
- MCP: `list_node_types` / `describe_node_type` / `get_bt` / `add_node` / `update_node` / `remove_node` / `set_param`

### Phase 2 — データ定義ノード
- `provider` / `pipeline` impl 種 + `frontend/node-ops.js` インタープリタ
- `%APPDATA%/Wend/nodepacks/` スキャン(custom_providers パターン踏襲)+ ホットリロード
- パックマネージャ UI + module 種の同意ゲート
- MCP: `validate_node_pack` / `save_node_pack`(AI 自律改善ループ開通)
- `.wendpack`(zip)エクスポート/インポート

### Phase 3 — 型システム
- `frontend/wend-types.js`(型 + coercion 表)
- パックノードへのポート宣言、`validate_tree` lint(warn-only)+ MCP ツール

### Phase 4 — 演算ノード(グラフ)
- `frontend/graph-engine.js`(トポロジカル実行、まず headless)+ builtin アクション `graph`
- MCP: `graph_add_node` / `graph_connect` / `graph_set_io`
- cytoscape キャンバスエディタ(同梱済みライブラリ使用)
- ショーケース: first-party ComfyUI ラッパーパック `wend.comfy`

### Phase 5 — 磨き込みと配布
- §2 のモジュール分割完遂
- electron-packager → **electron-builder**(win/mac/linux、自動更新、将来コード署名)。パス区切り等のクロスプラットフォーム監査、CI マトリクスビルド
- パックブラウザ(GitHub トピック方式、§4)
- ドキュメントサイト、初回起動テンプレートギャラリー(`sample/` を「コピーして開く」形で表出)

## 4. プロダクト戦略 — 「たくさんの人に使われるか」への率直な評価

### 4.1 競合環境

| 競合 | 領域 | Wend が機能競争で勝てるか |
|---|---|---|
| ComfyUI | ビジュアルメディア生成グラフ | 勝てない(生成グラフの深さ・エコシステム) |
| n8n / Dify | 業務自動化・LLM アプリ基盤 | 勝てない(コネクタ数・SaaS 展開) |
| LangFlow / Flowise | LLM チェーン試作 | 勝てない(Python エコシステム連携) |

**結論: 正面の機能競争はしない。** Wend にしかない組み合わせで空白ニッチを取る。

### 4.2 Wend 固有の強み(=磨くべき差別化)

1. **制御フローが第一級**: selector によるフォールバック、retry、error-pause、`manual` による human-in-the-loop。ComfyUI は「良い結果までリトライ」が書けず、Dify の分岐は浅い。**「判断と再試行ができるエージェントパイプライン」は空白地帯。**
2. **MCP ネイティブ**: エージェントが IDE 自体を操作・改善できる(現 30 ツール、[node-api-spec.md](node-api-spec.md) の粒度 API 後はさらに)。「あなたのエージェントが操作し、育てるパイプラインツール」という 2026 年的ストーリーを競合はまだ語れていない。
3. **ローカルファースト + 日本エコシステム**: VOICEVOX / VOICEBOX / LM Studio / Ollama / ComfyUI プロバイダ + 日本語ファースト i18n。日本のローカル AI コミュニティ(ComfyUI / VOICEVOX 層)は到達可能で、かつこの組み合わせを提供するツールがない**ビーチヘッド(初期浸透)市場**。

### 4.3 普及の障害(深刻度順)と対策

| # | 障害 | 対策 |
|---|---|---|
| 1 | **Windows 限定** | Phase 5 の electron-builder でクロスプラットフォーム化 |
| 2 | **共有ループの不在**: パック/レシピ/パイプラインに交換フォーマットも配布チャネルもない | **戦略の要**(§4.4)。`.wendpack` + GitHub トピックブラウザ |
| 3 | **見せられるものがない**: ドキュメントサイトなし、README にデモ GIF なし(radio サンプルは良質なのに埋もれている) | radio パイプラインの実行 GIF を README 冒頭に。Phase 5 でドキュメントサイト + テンプレートギャラリー |
| 4 | **一行ポジショニングの不在** | §4.5 の候補をテスト |

### 4.4 共有ループ — 戦略のキーストーン

骨格/データ分離設計([core-data-separation.md](core-data-separation.md))全体は、**共有単位を小さく・安全に・リミックス可能にする**ためにある。

- **フォーマット**: `.wendpack`(zip = pack.json + ハンドラ + サンプルツリー)。宣言的パック(provider/pipeline 種)は開くだけで安全、module 種のみ同意ゲート。
- **チャネル**: GitHub トピック `wend-pack` を検索するアプリ内ブラウザ。サーバーコストゼロ・審査コストゼロで始められる(初期 ComfyUI Manager と同じ方式)。人気が出たらキュレーション付きインデックスに移行。
- **種まき**: first-party パック 10 個(ComfyUI ラッパー、VOICEVOX 読み上げ、要約/翻訳/構造化抽出、Web 取得+整形、等)を最初に公開し「開いたら空」を防ぐ。
- **AI との相乗**: MCP の `save_node_pack` により、エージェントがユーザーのためにパックを作り、それがそのまま共有物になる。「使う → エージェントが改善 → 共有」の循環は競合にない増幅ループ。

### 4.5 ポジショニング候補

> **「リトライし、分岐し、人に尋ねられる — ローカルファーストの AI パイプライン IDE」**

(= 生成グラフではなくオーケストレーションと判断。英: "The local-first IDE for AI pipelines that can retry, branch, and ask you.")

### 4.6 README に反映すべき事項(本設計の実装時に)

- 冒頭にデモ GIF(radio サンプル実行)と上記ポジショニング一行
- 「bt.js が唯一のエンジン、bt-b3-* はコンバータ」の明記
- ノードパック仕様へのリンク(`designdoc/improve/core-data-separation.md`)
- `invoke` アクションのセキュリティ設定(`allowCommandExecution`)の説明

## 5. リスクと非目標

- **非目標**: フル DAG エディタへの移行、フレームワーク/バンドラ導入、SaaS 化。いずれも現行資産と独自性を毀損する。
- **リスク**: module 種パックはサンドボックスではなく同意ベース(Electron renderer で任意 JS が動く)。緩和策は同意ゲート + ハッシュ再同意 + MCP からの保存制限 + パックマネージャでの可視化。将来的に utility process 分離を検討課題として残す。
- **リスク**: ニッチ戦略は市場が小さい可能性がある。ただし ComfyUI も「SD の UI」という当初ニッチから拡大した。まず日本ローカル AI コミュニティでの実利用者 100 人を初期マイルストーンとする。
