# Wend Share Server

Wend のデータ同期・チーム共有を担う軽量サーバー。

## 基本原則

- **サーバーはデータ共有のみ。AI実行は一切行わない。**
- CPU/GPU は不要。リソース消費は極小。
- 各ユーザーは自分の API キー (`providers.json`) でローカルの Wend から LLM を呼ぶ。
- API キーは同期対象外（サーバーに送信しない）。
- セルフホスト可能。Docker コンテナ 1 つで動く。
- サーバー ⇄ クライアント間の通知は SSE (Server-Sent Events)、操作は REST API。

## データモデル（サーバー側）

### User

```json
{
  "id": "uuid",
  "username": "alice",
  "display_name": "Alice",
  "email": "alice@example.com",
  "password_hash": "bcrypt...",
  "created_at": "2026-06-22T00:00:00Z",
  "updated_at": "2026-06-22T00:00:00Z"
}
```

### Workspace

```json
{
  "id": "uuid",
  "name": "翻訳パイプライン開発",
  "description": "チームで翻訳パイプラインを共同開発",
  "owner_id": "uuid",
  "created_at": "2026-06-22T00:00:00Z",
  "updated_at": "2026-06-22T00:00:00Z",
  "version": 42
}
```

`version` はワークスペース単位の単調増加整数。操作 (Operation) がコミットされるたびに +1 される。クライアントはこの値を基準に差分同期を行う。

### Membership

```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "user_id": "uuid",
  "role": "editor",
  "joined_at": "2026-06-22T00:00:00Z"
}
```

| role | 権限 |
|------|------|
| `owner` | 全操作 + ワークスペース削除 + メンバー管理 |
| `admin` | 全操作 + メンバー管理（削除不可） |
| `editor` | データの作成・編集・削除 |
| `viewer` | 読み取りのみ |

### SyncTarget

同期対象となる個別データエンティティ。タブ、パイプライン、レシピの 1 ファイルが 1 SyncTarget に相当する。

```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "target_type": "tab",
  "target_name": "general.json",
  "current_version": 42,
  "locked_by": null,
  "locked_at": null,
  "checksum": "sha256hex..."
}
```

| target_type | 内容 | ファイル名の例 |
|-------------|------|---------------|
| `tab` | `data/*.json` のツリーデータ | `general.json`, `code.json` |
| `pipeline` | `pipelines.json` 内の個別パイプライン定義 | `pipelines.json` 全体が 1 SyncTarget |
| `recipe` | `projectrecipes.json` 内の個別レシピ | `projectrecipes.json` 全体が 1 SyncTarget |
| `chest` | `chests/*.json` のチェストデータ | `shared.json` |
| `session` | `session.json`（タブ一覧） | `session.json` |
| `history` | `history/run_*.json`（実行履歴） | `run_20260622_120000.json` |

### Operation

全変更履歴は Operation として追跡される。クライアント間の同期は Operation Log の差分適用で行う。

```json
{
  "id": "uuid",
  "workspace_id": "uuid",
  "target_type": "tab",
  "target_id": "syncTargetのid",
  "version": 43,
  "user_id": "uuid",
  "action": "update",
  "payload": {
    "content": "{ ... ツリーJSON ... }"
  },
  "parent_version": 42,
  "timestamp": "2026-06-22T12:00:00Z"
}
```

| action | 意味 |
|--------|------|
| `create` | 新規リソース作成 |
| `update` | 既存リソース更新（フル置換） |
| `delete` | リソース削除 |
| `lock` | ロック取得 |
| `unlock` | ロック解放 |

`parent_version` はクライアントが最後に確認したサーバーの version。サーバーはこれを使って競合検出を行う。

## REST API

全 API は `/api/` 以下。認証は JWT (Bearer Token)。

### 認証

#### `POST /api/auth/register`

ユーザー登録。

Request:
```json
{
  "username": "alice",
  "password": "password123",
  "display_name": "Alice"
}
```

Response `201`:
```json
{
  "user": { "id": "uuid", "username": "alice", "display_name": "Alice" },
  "token": "jwt...",
  "refresh_token": "uuid..."
}
```

#### `POST /api/auth/login`

ログイン。

Request:
```json
{
  "username": "alice",
  "password": "password123"
}
```

Response `200`:
```json
{
  "user": { "id": "uuid", "username": "alice", "display_name": "Alice" },
  "token": "jwt...",
  "refresh_token": "uuid..."
}
```

Error `401`:
```json
{
  "error": "invalid_credentials",
  "message": "Username or password is incorrect"
}
```

#### `POST /api/auth/refresh`

トークン更新。

Request:
```json
{
  "refresh_token": "uuid..."
}
```

Response `200`:
```json
{
  "token": "jwt..."
}
```

#### `GET /api/auth/me`

現在のユーザー情報。

Response `200`:
```json
{
  "id": "uuid",
  "username": "alice",
  "display_name": "Alice",
  "email": "alice@example.com",
  "created_at": "2026-06-22T00:00:00Z"
}
```

#### `PATCH /api/auth/me`

プロフィール更新。

Request:
```json
{
  "display_name": "Alice Wonderland"
}
```

Response `200`:
```json
{
  "id": "uuid",
  "username": "alice",
  "display_name": "Alice Wonderland"
}
```

#### `POST /api/auth/change-password`

パスワード変更。

Request:
```json
{
  "old_password": "password123",
  "new_password": "newpassword456"
}
```

Response `200`:
```json
{ "message": "Password changed" }
```

Error `400`:
```json
{ "error": "wrong_password", "message": "Old password is incorrect" }
```

---

### ワークスペース

#### `POST /api/workspaces`

ワークスペース作成。

Request:
```json
{
  "name": "翻訳パイプライン開発",
  "description": "チームで翻訳パイプラインを共同開発"
}
```

Response `201`:
```json
{
  "id": "uuid",
  "name": "翻訳パイプライン開発",
  "description": "チームで翻訳パイプラインを共同開発",
  "owner_id": "uuid",
  "created_at": "2026-06-22T00:00:00Z",
  "version": 0
}
```

作成者 (`owner_id`) は自動的に `owner` ロールのメンバーになる。

#### `GET /api/workspaces`

所属するワークスペース一覧。

Response `200`:
```json
{
  "workspaces": [
    {
      "id": "uuid",
      "name": "翻訳パイプライン開発",
      "description": "...",
      "role": "owner",
      "member_count": 3,
      "version": 42,
      "updated_at": "2026-06-22T12:00:00Z"
    }
  ]
}
```

#### `GET /api/workspaces/:id`

ワークスペース詳細。

Response `200`:
```json
{
  "id": "uuid",
  "name": "翻訳パイプライン開発",
  "description": "...",
  "owner_id": "uuid",
  "role": "owner",
  "member_count": 3,
  "version": 42,
  "created_at": "2026-06-22T00:00:00Z",
  "updated_at": "2026-06-22T12:00:00Z"
}
```

#### `PATCH /api/workspaces/:id`

ワークスペース更新。

Request:
```json
{
  "name": "翻訳パイプライン開発 v2",
  "description": "更新された説明"
}
```

Response `200`:
```json
{
  "id": "uuid",
  "name": "翻訳パイプライン開発 v2",
  "description": "更新された説明"
}
```

#### `DELETE /api/workspaces/:id`

ワークスペース削除（owner のみ）。

Response `204` No Content.

---

### メンバー管理

#### `GET /api/workspaces/:id/members`

メンバー一覧。

Response `200`:
```json
{
  "members": [
    { "user_id": "uuid", "username": "alice", "display_name": "Alice", "role": "owner",  "joined_at": "..." },
    { "user_id": "uuid", "username": "bob",   "display_name": "Bob",   "role": "editor", "joined_at": "..." },
    { "user_id": "uuid", "username": "charlie","display_name": "Charlie","role": "viewer","joined_at": "..." }
  ]
}
```

#### `POST /api/workspaces/:id/members`

メンバー招待。

Request:
```json
{
  "username": "bob",
  "role": "editor"
}
```

Response `201`:
```json
{
  "user_id": "uuid",
  "username": "bob",
  "role": "editor"
}
```

Error `404`:
```json
{ "error": "user_not_found", "message": "Username not found" }
```

#### `PATCH /api/workspaces/:id/members/:userId`

ロール変更（owner/admin のみ）。

Request:
```json
{
  "role": "viewer"
}
```

Response `200`:
```json
{
  "user_id": "uuid",
  "username": "bob",
  "role": "viewer"
}
```

#### `DELETE /api/workspaces/:id/members/:userId`

メンバー削除（admin/owner のみ。owner は削除不可）。

Response `204` No Content.

---

### 同期基盤

#### `GET /api/workspaces/:id/sync/targets`

同期対象一覧。

Response `200`:
```json
{
  "version": 42,
  "targets": [
    {
      "id": "uuid",
      "target_type": "tab",
      "target_name": "general.json",
      "current_version": 42,
      "checksum": "sha256hex..."
    },
    {
      "id": "uuid",
      "target_type": "pipeline",
      "target_name": "pipelines.json",
      "current_version": 40,
      "checksum": "..."
    },
    {
      "id": "uuid",
      "target_type": "recipe",
      "target_name": "projectrecipes.json",
      "current_version": 38,
      "checksum": "..."
    }
  ]
}
```

#### `GET /api/workspaces/:id/sync/operations?since=0&limit=1000`

差分操作ログ取得。`since` にはクライアントが最後に受け取った version を指定。サーバーは `since+1` 以降の Operation を返す。

Response `200`:
```json
{
  "version": 42,
  "operations": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "username": "alice",
      "target_type": "tab",
      "target_name": "general.json",
      "action": "update",
      "payload": { "content": "{...}" },
      "version": 5,
      "timestamp": "2026-06-22T12:00:00Z"
    }
  ],
  "has_more": false
}
```

`has_more` が `true` の場合、クライアントは再度同じエンドポイントに `since=返ってきた最後のversion` でリクエストする。

#### `POST /api/workspaces/:id/sync`

ローカルの変更を Operation としてプッシュ。同時に複数の操作を送信可能。

Request:
```json
{
  "operations": [
    {
      "target_type": "tab",
      "target_name": "general.json",
      "action": "update",
      "payload": { "content": "{...変更後のJSON...}" },
      "parent_version": 42
    },
    {
      "target_type": "recipe",
      "target_name": "projectrecipes.json",
      "action": "update",
      "payload": { "content": "[...変更後のレシピ一覧...]" },
      "parent_version": 40
    }
  ]
}
```

Response `200`（全操作成功）:
```json
{
  "status": "ok",
  "applied": [
    { "target_type": "tab", "target_name": "general.json", "version": 43 },
    { "target_type": "recipe", "target_name": "projectrecipes.json", "version": 44 }
  ],
  "new_version": 44
}
```

Response `409`（競合検出 → 一部却下）:
```json
{
  "status": "conflict",
  "applied": [
    { "target_type": "recipe", "target_name": "projectrecipes.json", "version": 43 }
  ],
  "rejected": [
    {
      "target_type": "tab",
      "target_name": "general.json",
      "reason": "version_conflict",
      "parent_version": 42,
      "server_version": 43,
      "server_checksum": "sha256hex...",
      "conflict_detail": "alice が version 43 で同じファイルを更新しました"
    }
  ],
  "new_version": 44
}
```

クライアントは rejected された操作について、最新のサーバー側データを取得し、マージする必要がある。

---

### タブデータ（個別アクセス）

競合検出後のリカバリ用に、個別の SyncTarget の最新スナップショットを取得できる。

#### `GET /api/workspaces/:id/tabs/:tabName`

タブデータの最新スナップショット取得。

Response `200`:
```json
{
  "target_name": "general.json",
  "version": 43,
  "checksum": "sha256hex...",
  "content": { "... ツリーJSON ..." }
}
```

#### `PUT /api/workspaces/:id/tabs/:tabName`

タブデータの直接更新。`parent_version` で競合チェックを行う。

Request:
```json
{
  "content": { "... ツリーJSON ..." },
  "parent_version": 42
}
```

Response `200`:
```json
{
  "version": 43,
  "checksum": "sha256hex..."
}
```

Response `409`:
```json
{
  "error": "version_conflict",
  "server_version": 43,
  "message": "alice が version 43 で更新済み"
}
```

---

### パイプライン

#### `GET /api/workspaces/:id/pipelines`

全パイプライン定義取得。

Response `200`:
```json
{
  "version": 38,
  "pipelines": [
    {
      "name": "翻訳→比較選択",
      "steps": [
        { "name": "Multi-translate", "type": "ai", "provider": "anthropic", "model": "claude-sonnet-4-6", "params": { "systemPrompt": "...", "userPrompt": "...", "temperature": 0.3 } },
        { "name": "比較選択", "type": "manual", "params": { "mode": "compare" } },
        { "name": "Review", "type": "ai", "provider": "openai", "model": "gpt-4.1", "params": { "userPrompt": "レビューしてください: {content}" } }
      ]
    }
  ]
}
```

#### `POST /api/workspaces/:id/pipelines`

新規パイプライン追加。

Request:
```json
{
  "name": "翻訳→比較選択",
  "steps": [ ... ]
}
```

Response `201`:
```json
{
  "version": 39,
  "name": "翻訳→比較選択"
}
```

Error `409`:
```json
{ "error": "duplicate_name", "message": "Pipeline with this name already exists" }
```

#### `PUT /api/workspaces/:id/pipelines/:pipelineName`

パイプライン更新（全置換）。

Request:
```json
{
  "steps": [ ... ],
  "parent_version": 38
}
```

Response `200`:
```json
{
  "version": 39,
  "checksum": "sha256hex..."
}
```

#### `DELETE /api/workspaces/:id/pipelines/:pipelineName`

パイプライン削除。

Response `204` No Content.

---

### レシピ

#### `GET /api/workspaces/:id/recipes`

全レシピ取得。

Response `200`:
```json
{
  "version": 36,
  "recipes": [
    {
      "name": "Claude Sonnet 翻訳",
      "type": "ai",
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "temperature": 0.3,
      "systemPrompt": "You are a professional translator."
    }
  ]
}
```

#### `POST /api/workspaces/:id/recipes`

新規レシピ追加。

Request:
```json
{
  "name": "Claude Sonnet 翻訳",
  "type": "ai",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "temperature": 0.3,
  "systemPrompt": "You are a professional translator."
}
```

Response `201`:
```json
{
  "version": 37,
  "name": "Claude Sonnet 翻訳"
}
```

#### `PUT /api/workspaces/:id/recipes/:recipeName`

レシピ更新。

Request:
```json
{
  "temperature": 0.5,
  "parent_version": 36
}
```

Response `200`:
```json
{
  "version": 37,
  "checksum": "sha256hex..."
}
```

#### `DELETE /api/workspaces/:id/recipes/:recipeName`

レシピ削除。

Response `204` No Content.

---

### チェスト（共有バッファ）

#### `GET /api/workspaces/:id/chests`

全チェスト一覧。

Response `200`:
```json
{
  "version": 10,
  "chests": [
    {
      "name": "チーム入力データ",
      "content": "共有テキストデータ...",
      "mimetype": "text/plain",
      "updated_by": "alice",
      "updated_at": "2026-06-22T12:00:00Z"
    }
  ]
}
```

#### `PUT /api/workspaces/:id/chests/:chestName`

チェスト内容更新（上書き）。

Request:
```json
{
  "content": "更新された共有テキスト",
  "mimetype": "text/plain",
  "parent_version": 10
}
```

Response `200`:
```json
{
  "version": 11,
  "checksum": "sha256hex..."
}
```

---

### 実行履歴（共有オプション）

#### `GET /api/workspaces/:id/history`

共有実行履歴一覧。

Response `200`:
```json
{
  "runs": [
    {
      "id": "run_20260622_120000",
      "pipeline_name": "翻訳→比較選択",
      "tab_name": "general.json",
      "user_id": "uuid",
      "username": "alice",
      "created_at": "2026-06-22T12:00:00Z",
      "status": "completed"
    }
  ],
  "version": 15
}
```

#### `GET /api/workspaces/:id/history/:runId`

個別実行履歴詳細。

Response `200`:
```json
{
  "id": "run_20260622_120000",
  "pipeline_name": "翻訳→比較選択",
  "user_id": "uuid",
  "username": "alice",
  "tab_name": "general.json",
  "status": "completed",
  "steps": [
    { "index": 0, "name": "Multi-translate", "type": "ai", "status": "completed", "tokens": 312, "ms": 2340, "output": "Hello world..." },
    { "index": 1, "name": "比較選択", "type": "manual", "status": "completed", "output": "Hello world..." }
  ],
  "created_at": "2026-06-22T12:00:00Z",
  "version": 15
}
```

#### `DELETE /api/workspaces/:id/history/:runId`

実行履歴削除。

Response `204` No Content.

---

### ロック

明示的なロック機構。ノード単位またはタブ単位でロック可能。

#### `POST /api/workspaces/:id/locks`

ロック取得。

Request:
```json
{
  "target_type": "tab",
  "target_name": "general.json",
  "ttl_seconds": 300
}
```

Response `201`:
```json
{
  "lock_id": "uuid",
  "target_type": "tab",
  "target_name": "general.json",
  "user_id": "uuid",
  "username": "alice",
  "acquired_at": "2026-06-22T12:00:00Z",
  "expires_at": "2026-06-22T12:05:00Z"
}
```

Error `409`:
```json
{
  "error": "already_locked",
  "locked_by": "bob",
  "expires_at": "2026-06-22T12:05:00Z",
  "message": "bob が編集中です"
}
```

#### `DELETE /api/workspaces/:id/locks/:lockId`

ロック解放（ロック取得者のみ可能）。`force` オプションで admin/owner は他者のロックを解除可能。

Request:
```json
{
  "force": true
}
```

Response `204` No Content.

#### `GET /api/workspaces/:id/locks`

アクティブなロック一覧。

Response `200`:
```json
{
  "locks": [
    {
      "lock_id": "uuid",
      "target_type": "tab",
      "target_name": "general.json",
      "username": "alice",
      "acquired_at": "2026-06-22T12:00:00Z",
      "expires_at": "2026-06-22T12:05:00Z"
    }
  ]
}
```

#### `PUT /api/workspaces/:id/locks/:lockId/renew`

ロック延長。

Request:
```json
{
  "ttl_seconds": 300
}
```

Response `200`:
```json
{
  "expires_at": "2026-06-22T12:10:00Z"
}
```

---

### ヘルスチェック

#### `GET /api/health`

サーバー死活確認。

Response `200`:
```json
{
  "status": "ok",
  "uptime_seconds": 12345,
  "version": "0.1.0"
}
```

## SSE イベントストリーム

### `GET /api/workspaces/:id/events`

Server-Sent Events のストリーム。認証済みのクライアントが購読する。再接続時は `Last-Event-ID` ヘッダー（またはクエリパラメータ `?last_id=xxx`）で途切れた位置から再開可能。

```
GET /api/workspaces/xxx/events
Authorization: Bearer <jwt>
Accept: text/event-stream
```

レスポンス（text/event-stream）:

```
event: operation
id: op-uuid-1
data: {"version":43,"user_id":"uuid","username":"alice","target_type":"tab","target_name":"general.json","action":"update","timestamp":"2026-06-22T12:00:00Z"}

event: lock_acquired
id: lock-uuid-1
data: {"target_type":"tab","target_name":"general.json","username":"alice","expires_at":"2026-06-22T12:05:00Z"}

event: lock_released
id: lock-uuid-2
data: {"target_type":"tab","target_name":"general.json"}

event: member_joined
id: mem-uuid-1
data: {"username":"bob","role":"editor"}

event: member_left
id: mem-uuid-2
data: {"username":"bob"}

event: workspace_updated
id: ws-uuid-1
data: {"name":"翻訳パイプライン開発 v2"}
```

### イベント一覧

| イベント名 | タイミング | データ |
|-----------|-----------|--------|
| `operation` | 新規 Operation がコミットされた | version, user_id, username, target_type, target_name, action, timestamp |
| `lock_acquired` | ロックが取得された | target_type, target_name, username, expires_at |
| `lock_released` | ロックが解放された | target_type, target_name |
| `lock_expired` | ロックが期限切れになった | target_type, target_name |
| `member_joined` | 新メンバーが追加された | username, role |
| `member_left` | メンバーが削除された | username |
| `member_updated` | メンバーのロールが変更された | username, old_role, new_role |
| `workspace_updated` | ワークスペース情報が更新された | name, description |
| `ping` | 30秒間隔で送信（コネクション維持） | timestamp |

## 同期プロトコル（クライアント実装手順）

### 初回接続

```
1. クライアント起動
2. GET /api/auth/login (or /refresh) → Token 取得
3. GET /api/workspaces → ワークスペース一覧
4. ユーザーがワークスペースを選択
5. GET /api/workspaces/:id/sync/operations?since=0 → 全Operation取得
6. クライアント: Operation をローカルに適用（初回は全タブ作成）
7. GET /api/workspaces/:id/events → SSE 購読開始
```

### 通常同期（編集時）

```
1. ユーザーがノードを編集
2. クライアント: 編集対象の SyncTarget 名を決定（例: general.json）
3. POST /api/workspaces/:id/locks
   → ロック取得成功 (201) → 編集可能
   → ロック取得失敗 (409) → 読み取り専用モードに
4. ユーザーが保存
5. POST /api/workspaces/:id/sync
   {
     "operations": [{
       "target_type": "tab",
       "target_name": "general.json",
       "action": "update",
       "payload": { "content": "..." },
       "parent_version": 42
     }]
   }
6. DELETE /api/workspaces/:id/locks/:lockId → ロック解放
7. 他のクライアントは SSE `operation` イベントを受信 → ローカルに適用
```

### 競合発生時

```
1. クライアント A: POST /api/workspaces/:id/sync
   → Response 409 (version_conflict)
2. クライアント A の表示:
   「alice が general.json を更新しました。どちらかを選んでください:」
   ┌──────────────────────────────────┐
   │ [Alice の変更]   [自分の変更]    │
   │ ───────────────  ─────────────  │
   │ (差分表示)        (差分表示)     │
   │              [手動マージ]        │
   └──────────────────────────────────┘
3. クライアント A が「Alice の変更」を選ぶ:
   → GET /api/workspaces/:id/tabs/general.json で最新を取得
   → ローカルに反映
   → ユーザーの編集内容は失われる（手動マージが必要な場合は手動）
4. クライアント A が「手動マージ」を選ぶ:
   → サーバー版と自分版の diff 表示
   → ユーザーが編集して保存
   → 再送 (parent_version = 43)
```

### オフライン時

```
1. ネットワーク切断 → ローカルの Operation Queue に操作を蓄積
2. 切断中もローカル編集は可能
3. 再接続後:
   a. SSE 再接続 (EventSource が自動リトライ)
   b. GET /api/workspaces/:id/sync/operations?since={last_version}
      → オフライン中に他者が行った変更を取得
   c. ローカルキュー内の操作について競合チェック:
      - 競合なし → POST /api/workspaces/:id/sync で送信
      - 競合あり → 上記競合解決フロー
```

## サーバー起動・設定

### Docker Compose

```yaml
version: '3.8'
services:
  wend-sync:
    image: wend/sync-server:latest
    container_name: wend-sync
    ports:
      - "3742:3742"
    volumes:
      - wend-data:/app/data
    environment:
      - JWT_SECRET=change-this-to-random-string
      - PORT=3742
      - DB_PATH=/app/data/wend-sync.db
      - MAX_UPLOAD_SIZE=10485760
    restart: unless-stopped

volumes:
  wend-data:
```

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `PORT` | `3742` | サーバー待受ポート |
| `DB_PATH` | `./wend-sync.db` | SQLite データベースパス |
| `JWT_SECRET` | (必須) | JWT 署名キー |
| `JWT_EXPIRY` | `24h` | JWT 有効期限 |
| `MAX_UPLOAD_SIZE` | `10485760` | ペイロード最大サイズ (bytes) |
| `LOCK_TTL_MAX` | `1800` | ロック最大有効時間 (秒) |
| `RATE_LIMIT_WINDOW` | `60000` | レート制限ウィンドウ (ms) |
| `RATE_LIMIT_MAX` | `100` | 1ウィンドウあたりの最大リクエスト数 |
| `LOG_LEVEL` | `info` | ログレベル |

### ファイル構成（リポジトリ）

```
shareserver/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── src/
│   ├── index.js              ← エントリポイント
│   ├── app.js                ← Express アプリセットアップ
│   ├── config.js             ← 環境変数読み込み
│   ├── db/
│   │   ├── connection.js     ← SQLite 初期化
│   │   ├── migrate.js        ← テーブル作成・マイグレーション
│   │   └── models/
│   │       ├── user.js
│   │       ├── workspace.js
│   │       ├── membership.js
│   │       ├── sync_target.js
│   │       └── operation.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── workspaces.js
│   │   ├── members.js
│   │   ├── sync.js
│   │   ├── tabs.js
│   │   ├── pipelines.js
│   │   ├── recipes.js
│   │   ├── chests.js
│   │   ├── history.js
│   │   ├── locks.js
│   │   ├── events.js
│   │   └── health.js
│   ├── middleware/
│   │   ├── auth.js           ← JWT 検証
│   │   ├── rbac.js           ← ロール権限チェック
│   │   ├── rate_limit.js
│   │   └── validate.js       ← バリデーション
│   ├── services/
│   │   ├── sync_service.js   ← 操作ログ管理・競合検出
│   │   ├── lock_service.js   ← ロック管理
│   │   ├── workspace_service.js
│   │   └── sse_manager.js    ← SSE コネクション管理
│   └── utils/
│       ├── hash.js
│       ├── jwt.js
│       └── version.js
└── tests/
    ├── auth.test.js
    ├── sync.test.js
    ├── locks.test.js
    └── concurrent.test.js
```

### SQLite テーブル設計

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  refresh_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, user_id)
);

CREATE TABLE sync_targets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  target_type TEXT NOT NULL CHECK(target_type IN ('tab','pipeline','recipe','chest','session','history')),
  target_name TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0,
  locked_by TEXT REFERENCES users(id),
  locked_at TEXT,
  checksum TEXT,
  UNIQUE(workspace_id, target_type, target_name)
);

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  version INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('create','update','delete','lock','unlock')),
  payload TEXT,  -- JSON string
  parent_version INTEGER,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, version)
);

CREATE INDEX idx_operations_ws_version ON operations(workspace_id, version);
CREATE INDEX idx_sync_targets_ws ON sync_targets(workspace_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);
```

## 競合検出アルゴリズム

### 基本原理

- 各 Operation は `parent_version` を持つ（クライアントが最後に確認したサーバーの version）。
- サーバーは Operation 到着時に `parent_version` と現在の SyncTarget の `current_version` を比較。
- `parent_version < current_version` の場合、競合と判定。

### 競合解決ポリシー（サーバー側）

1. **同一 SyncTarget に複数の更新が連続した場合**
   - 先着の更新は受理（version 発行）
   - 後着は `409 Conflict` で reject
   - クライアントはサーバー側の最新データを取得してマージ

2. **異なる SyncTarget への同時更新**
   - 競合なし。両方受理。

3. **ロック保持者の更新**
   - ロック中は `parent_version` チェックを行わず常に受理（ロックが保証）
   - ロック解放後は通常の競合チェックに戻る

### クライアント側の競合解決UI

競合発生時、Wend の UI には以下の 3 つの選択肢を表示する：

1. **サーバー版を採用** → 自分の変更は破棄
2. **自分の版を採用** → 再度送信（force）
3. **手動マージ** → 左右に差分表示、エディタで編集後再送

## セキュリティ考慮

| 項目 | 対策 |
|------|------|
| 認証 | JWT（アクセストークン）+ Refresh Token |
| パスワード | bcrypt でハッシュ化 |
| 転送 | HTTPS 推奨（Docker デプロイ時はリバースプロキシで対応） |
| APIキー | サーバーに送信しない。ローカルの `providers.json` のみ |
| レート制限 | エンドポイント単位で制限 |
| CORS | ホワイトリスト方式 |
| 入力検証 | JSON Schema バリデーション（各ペイロードの構造チェック） |

## 非同期コラボレーションの流れ（ユーザー視点）

```
Alice: タブ「general.json」を開く
     → 自動ロック取得 (Lock アイコン表示 "Alice が編集中")
     → ノードを編集 → 保存
     → ロック解放

Bob:  タブ「general.json」一覧で Lock アイコン確認
     → "Alice が編集中" → 読み取り専用モードで開く
     → Alice が保存 → SSE 通知 → 自動的に Bob の画面も更新
     → Alice が閉じる → ロック解放
     → Bob: 編集可能になる（通知あり）

Charlie: 同じワークスペースを参照
      → 変更履歴タブで誰がいつ何を変更したか確認可能
      → 特定のバージョンに戻すことも可能（admin/owner）
```
