# 拡張ノード API 仕様 — WendNodes / ctx コントラクト / MCP 粒度 API

> 対象バージョン: Wend 0.2 系 (roadmap Phase 1–2 で導入、Phase 4 でグラフ対応拡張)
> 関連文書: [core-data-separation.md](core-data-separation.md), [graph-node-design.md](graph-node-design.md)

## 1. 登録ライフサイクル

```
起動時:
  scan frontend/nodepacks/*.json               … 同梱パック
  scan %APPDATA%/Wend/nodepacks/*/pack.json    … ユーザーパック
    → JSON Schema 検証(不合格はスキップ + 警告。1 パックの失敗が他に波及しない —
      main.js のプロバイダローダと同じ 1-try/catch-per-item 方針)
    → requires 解決(app バージョン、依存パック)
    → WendNodes.registerPack(packJson, { source })
    → impl.kind === "module" のパック: 同意記録(config.json 内、パックID+コンテンツハッシュ)
      を確認 → 未同意なら同意ダイアログをキューイング → 拒否時はそのノード型を無効化
      (パック自体の宣言的ノードは有効なまま)

実行時:
  IPC `reload_node_packs` → 再スキャン → レジストリ差分更新。
  実行中の BT run は開始時点の定義スナップショットで完走する(run 開始時に解決済み
  ハンドラ参照を run コンテキストに束縛する)。
```

## 2. `window.WendNodes` — レジストリ API

`frontend/bt-registry.js` の `BtActionRegistry`(`window.btActions`)を発展させた正式レジストリ。**`window.btActions` は薄い後方互換ファサードとして残す**(`register(name, config)` は builtin ハンドラ登録 + 最小ノード定義生成に変換され、`get`/`getAll`/`getLabel` は WendNodes に委譲)。

```js
window.WendNodes = {
  apiVersion: 1,

  // パック(宣言的定義)の登録。source: 'builtin' | 'user' | 'mcp'
  registerPack(packJson, { source }),

  // builtin / module 種の実体ハンドラ登録
  // fn: async (ctx) => boolean | { status, outputs? }
  registerHandler(name, fn),

  get(type),              // ノード定義(パック由来のメタデータ+解決済みハンドラ)
  has(type),
  byCategory(),           // { io: [...], media: [...], ai: [...], ... } — パレット/ドロップダウン用
  getAllTypes(),
  validateParams(type, params),   // params 記述子に対する値検証 → { ok, errors[] }
  resolveCompat(node),    // レガシー btAction/bt* フィールド → { type, params } に解決
};
```

- **バージョニング方針**: `apiVersion` のメジャー内は**加算的変更のみ**(フィールド追加は可、意味変更・削除は不可)。パックは `requires.app` でアプリ最低バージョンを宣言。ハンドラは `ctx.apiVersion` で実行時判別できる。

## 3. ctx コントラクト v1

現行の ctx(`bt.js` `_runAction` が構築する `{bt, app, path, node, inputKey, outputKey, outputType, prompt, textInput, mediaArr, setCleanup}`)の**スーパーセット**。既存 11 ハンドラは無改修で動く。

```js
{
  apiVersion: 1,

  // ── 位置と定義 ──
  node,                    // ツリー上のノード JSON(読み取り用)
  path,                    // ツリーパス文字列
  params,                  // 解決済みパラメータバッグ(btParams + compat.paramMap で
                           //   レガシーフィールドから吸い上げた値。base64 は復号済み)

  // ── 入出力(モード依存)──
  // グラフモード: inputs = Map<portName, TypedValue>
  // BT リーフモード: 既存どおり btInputKey から導出した textInput/mediaArr を
  //   既定ポートに詰めた Map(+ レガシーエイリアスも供給)
  inputs,
  io: {
    read(port),                    // TypedValue | undefined
    write(port, value, type),      // グラフ: 出力ポートへ / BT: bbDefault ポート→btOutputKey へ
  },

  // ── Blackboard 直接アクセス ──
  bb: {
    readText(key), readMedia(key), readData(key),
    write(key, value, scope = 'run', field = 'text'),
    keys(scope),
  },

  // ── 実行制御・観測 ──
  log: { info(msg), warn(msg), error(msg), progress(pct, msg) },
  signal,                  // AbortSignal — stop() で abort。setCleanup はこの上の互換シムとして維持

  // ── 骨格サービス(IPC の安全なラッパ)──
  services: {
    http(opts),                       // bt_http_request ラッパ(url, method, headers, body)
    file: {
      read(filePath, basePath),       // bt_load_local_file ラッパ → {content, mimetype, file}
      writeTemp(content, filename),   // bt_media_to_file ラッパ → path
    },
    provider(recipeName, req),        // データノードを作らずにプロバイダ 1 呼び出し
                                      //   (グラフ内 provider 種ノードの実行にも使用)
    ui: { manual(mode, prompt, choices) },  // bt_manual_pause ラッパ(human-in-the-loop)
  },

  // ── レガシーエイリアス(builtin 専用、非推奨だが維持)──
  bt, app, prompt, textInput, mediaArr, inputKey, outputKey, outputType, outputScope,
  setCleanup(fn),
}
```

**信頼境界**: 危険な生オブジェクト `app` / `bt` は **builtin ハンドラにのみ**渡す。`module` 種パックのハンドラには上記の構造化 API(`params`/`inputs`/`io`/`bb`/`log`/`signal`/`services`)だけを渡す。module ハンドラが必要とする能力はすべて `services` 経由で提供し、能力の追加 = `services` の拡張として管理する。

**戻り値**: `boolean`(従来互換、true=success)または `{ status: 'success'|'failure', outputs?: {port: value} }`。

## 4. MCP 粒度 API

現状の MCP は `create_bt` による**ツリー全置換しかできず**、エージェントは 1 ノード直すために全体を再送する必要がある。以下を `mcp-server/index.js` + `electron/main.js` の HTTP ブリッジ(port 18765)+ renderer 側ツリー編集関数(既存の `app` のノード操作を再利用)に追加する。

### 4.1 ツリー読取・編集

| ツール | 説明 |
|---|---|
| `get_bt(tab)` | ツリー全体を JSON で取得(各ノードに `path` 付与) |
| `add_node(parentPath, index, spec)` | ノード追加 → 新 `path` を返す。`spec` = `{type, params, btType, title, ...}` |
| `update_node(path, patch)` | 部分更新(送られたフィールドのみ) |
| `remove_node(path)` | 削除(子ごと) |
| `move_node(path, newParentPath, index)` | 移動 |
| `set_param(path, name, value)` | パラメータ 1 個の設定(`btParams` バッグ経由、compat 変換込み) |

### 4.2 ノード型の発見(エージェント用「API ドキュメント」)

| ツール | 説明 |
|---|---|
| `list_node_types()` | 全ノード型の一覧(type/label/category/impl.kind) |
| `describe_node_type(type)` | ports / params 記述子 / defaults / description を返す。エージェントはこれを読んでから `add_node` する |

### 4.3 検証

| ツール | 説明 |
|---|---|
| `validate_tree(tab)` | [graph-node-design.md](graph-node-design.md) §6 の lint(未書込キー読出・型不一致・デッドデータ)。warn-only の結果リストを返す |

### 4.4 グラフ編集(Phase 4)

| ツール | 説明 |
|---|---|
| `graph_add_node(leafPath, spec)` | `btGraph.nodes` へ追加 |
| `graph_connect(leafPath, from, to)` | エッジ追加(型検証・サイクル検証込み、拒否理由を返す) |
| `graph_set_io(leafPath, inputs, outputs)` | 境界 I/O(bbKey バインド)設定 |

### 4.5 ノードパック(Phase 2)

| ツール | 説明 |
|---|---|
| `list_node_packs()` | パック一覧 |
| `get_node_pack(id)` | パック JSON 取得 |
| `validate_node_pack(json)` | スキーマ検証 + lint(未知 provider/recipe 参照、ポート型エラー、未使用 param) |
| `save_node_pack(json)` | 保存 + ホットリロード。module 種は `allowModulePacksFromMcp` フラグなしで拒否 |

### 4.6 エージェントの標準ワークフロー

```
describe_node_type → add_node → set_param → validate_tree → run_bt
  → get_status / get_blackboard で観察 → update_node / set_param で修正 → 再実行
```

全置換 (`create_bt`) と違い、増分・検証可能・差分レビュー可能。既存の `create_bt` は「テンプレートから一括生成」用途として残す。

## 5. エラーモデル

- すべての編集ツールは `{ ok: true, ... }` または `{ ok: false, error: { code, message, path? } }` を返す。
- 代表コード: `UNKNOWN_NODE_TYPE` / `INVALID_PARAM` / `TYPE_MISMATCH` / `CYCLE_DETECTED` / `PATH_NOT_FOUND` / `PACK_VALIDATION_FAILED` / `MODULE_PACK_FORBIDDEN`。
- 検証系は例外ではなく結果リストで返す(エージェントがそのまま修正ループに使えるように)。
