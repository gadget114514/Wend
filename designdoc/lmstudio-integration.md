# Wend に LM Studio をプロバイダーとして追加する

LM Studio を Wend のバックエンド AI として統合するための技術ドキュメント。

## 概要

LM Studio はローカルで LLM を実行するデスクトップアプリケーション。OpenAI 互換の REST API を提供するため、Wend の既存の「OpenAI 互換プロバイダー」機能で接続可能。

### 2つのアプローチ

| アプローチ | 概要 | 工数 | 推奨 |
|-----------|------|------|------|
| **A. 既存の OpenAI 互換プロバイダーを使用** | コード変更なし。ユーザーが手動で設定 | 0 | 一般ユーザー向け |
| **B. 専用プロバイダーを追加** | Wend に LM Studio 用のプロバイダーコードを追加 | 小 | 開発者向け |

---

## アプローチ A: 既存の OpenAI 互換プロバイダーを使用（コード変更なし）

### 手順

1. **LM Studio をインストール・起動**
   - [LM Studio](https://lmstudio.ai/) をダウンロード
   - モデルをダウンロード（例: `llama-3.2-8b-instruct`）
   - 「Start Server」ボタンでローカルサーバーを起動
   - デフォルトのポート: `1234`

2. **Wend で設定**
   - Wend を起動 → ⚙ Config を開く
   - 「OpenAI」セクションで以下を設定:
     - **API Key**: 任意の文字列（例: `lm-studio`、LM Studio は API キーを要求しない）
     - **Base URL**: `http://localhost:1234/v1`
   - 「Test Connection」で接続確認

3. **レシピを作成**
   - Recipe Manager で新規レシピを作成
   - Provider: `openai`
   - Model: LM Studio で読み込んだモデル名（例: `llama-3.2-8b-instruct`）
   - Base URL override: `http://localhost:1234/v1`

### 制限事項

- ユーザーが毎回 Base URL を手動設定する必要がある
- モデル一覧の自動取得ができない（手動でモデル名を入力）
- UI 上で「LM Studio」というラベルが表示されない

---

## アプローチ B: 専用プロバイダーを追加（コード変更）

Wend のソースコードに LM Studio 用のプロバイダーを追加する方法。

### 必要なファイル変更

```
electron/
├── main.js                              ← プロバイダー登録を追加
└── providers/
    └── lmstudio.js                      ← 新規作成

frontend/
└── defaults/
    ├── appproviders.json                ← LM Studio のメタデータを追加
    └── recipes-lmstudio.json            ← (任意) デフォルトレシピを追加
```

### 1. `electron/providers/lmstudio.js` を作成

```javascript
const { httpRequest } = require('./utils');

class LMStudioProvider {
    constructor(apiKey, baseUrl) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl || 'http://localhost:1234/v1';
    }

    name() { return 'lmstudio'; }

    defaultModels() {
        return ['llama-3.2-8b-instruct', 'mistral-7b-instruct', 'phi-3-mini'];
    }

    _buildBody(req) {
        const messages = [];
        if (req.systemPrompt) {
            messages.push({ role: 'system', content: req.systemPrompt });
        }

        const attachments = req.attachments || [];
        const images = attachments.filter(a => a.mimetype?.startsWith('image/'));

        let userContent;
        if (images.length > 0) {
            userContent = [{ type: 'text', text: req.userPrompt }];
            for (const img of images) {
                userContent.push({
                    type: 'image_url',
                    image_url: { url: `data:${img.mimetype};base64,${img.content}` }
                });
            }
        } else {
            userContent = req.userPrompt;
        }

        messages.push({ role: 'user', content: userContent });

        return JSON.stringify({
            model: req.model,
            messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 4096,
            stream: false,
        });
    }

    async call(req) {
        const body = this._buildBody(req);
        let url;

        if (req.apiPath) {
            const apiPath = req.apiPath.replace('{model}', req.model);
            url = this.baseUrl.replace(/\/$/, '') + '/' + apiPath.replace(/^\//, '');
        } else {
            url = this.baseUrl.replace(/\/$/, '') + '/chat/completions';
        }

        const raw = await httpRequest(
            url, 'POST',
            { 'Content-Type': 'application/json' },
            body
        );

        if (!raw) {
            throw new Error(
                `LM Studio API Error\n` +
                `Provider: lmstudio\n` +
                `Model: ${req.model}\n` +
                `URL: ${url}\n` +
                `Error: Empty response received\n` +
                `Possible causes: LM Studio server not running, model not loaded, or connection refused`
            );
        }

        const j = JSON.parse(raw);

        if (j.error) {
            throw new Error(
                `LM Studio API Error\n` +
                `Provider: lmstudio\n` +
                `Model: ${req.model}\n` +
                `URL: ${url}\n` +
                `Error: ${j.error.message || JSON.stringify(j.error)}\n` +
                `Error type: ${j.error.type || 'unknown'}`
            );
        }

        return {
            content: j.choices?.[0]?.message?.content ?? '[LM Studio: no content]',
            model: req.model,
            requestUrl: url,
            requestBody: body
        };
    }

    async listModels() {
        try {
            const url = this.baseUrl.replace(/\/$/, '') + '/models';
            const raw = await httpRequest(url, 'GET', {}, null);
            const j = JSON.parse(raw);
            if (j.data) {
                return j.data.map(m => m.id).sort();
            }
        } catch (e) {
            console.error('[LMStudio] listModels error:', e.message);
        }
        return this.defaultModels();
    }

    async testConnection() {
        try {
            const url = this.baseUrl.replace(/\/$/, '') + '/models';
            const raw = await httpRequest(url, 'GET', {}, null);
            const j = JSON.parse(raw);
            if (j.error) {
                return j.error.message || 'Unknown error';
            }
            if (j.data) {
                return '';  // 空文字列 = 成功
            }
            return 'Unexpected response format';
        } catch (e) {
            return e.message;
        }
    }
}

module.exports = LMStudioProvider;
```

### 2. `electron/main.js` でプロバイダーを登録

`builtinProviders` の読み込みリストに `lmstudio` を追加する。

**変更箇所: 305〜317行目付近**

```javascript
// 変更前:
for (const [key, file] of [
    ['openai',       './providers/openai'],
    ['anthropic',    './providers/anthropic'],
    ['gemini',       './providers/gemini'],
    ['ollama',       './providers/ollama'],
    ['opencode',     './providers/opencode'],
    ['mock',         './providers/mock'],
    ['mock-http',    './providers/mock-http'],
    ['openai-image', './providers/openai-image'],
    ['gemini-image', './providers/gemini-image'],
    ['replicate',    './providers/replicate'],
    ['fal-ai',       './providers/fal-ai'],
]) {

// 変更後:
for (const [key, file] of [
    ['openai',       './providers/openai'],
    ['anthropic',    './providers/anthropic'],
    ['gemini',       './providers/gemini'],
    ['ollama',       './providers/ollama'],
    ['lmstudio',     './providers/lmstudio'],  // ← 追加
    ['opencode',     './providers/opencode'],
    ['mock',         './providers/mock'],
    ['mock-http',    './providers/mock-http'],
    ['openai-image', './providers/openai-image'],
    ['gemini-image', './providers/gemini-image'],
    ['replicate',    './providers/replicate'],
    ['fal-ai',       './providers/fal-ai'],
]) {
```

### 3. `frontend/defaults/appproviders.json` に LM Studio を追加

```json
{
    "id": "lmstudio",
    "label": "LM Studio",
    "defaultUrl": "http://localhost:1234/v1",
    "defaultApiPath": "/chat/completions",
    "defaultFormat": "lmstudio",
    "formatLabel": "LM Studio (Local)",
    "apiType": "simple",
    "input": ["text", "image"],
    "output": ["text"],
    "description": "Local LLM via LM Studio"
}
```

**追加位置:** `ollama` の直後（ローカルプロバイダー群の中に配置）

### 4. (任意) `frontend/defaults/recipes-lmstudio.json` でデフォルトレシピを追加

```json
[
    {
        "name": "LM Studio - Local Chat",
        "type": "ai",
        "provider": "lmstudio",
        "model": "llama-3.2-8b-instruct",
        "temperature": 0.7,
        "systemPrompt": "You are a helpful assistant."
    },
    {
        "name": "LM Studio - Summarize",
        "type": "ai",
        "provider": "lmstudio",
        "model": "llama-3.2-8b-instruct",
        "temperature": 0.3,
        "systemPrompt": "Summarize the following text concisely."
    },
    {
        "name": "LM Studio - Translate to English",
        "type": "ai",
        "provider": "lmstudio",
        "model": "llama-3.2-8b-instruct",
        "temperature": 0.3,
        "systemPrompt": "Translate the following text to English."
    }
]
```

---

## プロバイダーインターフェース仕様

Wend のプロバイダーは以下のインターフェースを実装する必要がある。

### コンストラクタ

```javascript
constructor(apiKey, baseUrl)
```

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| `apiKey` | string | API キー（LM Studio は不要なので空文字列でも可） |
| `baseUrl` | string | API のベース URL |

### メソッド

#### `name(): string`

プロバイダーの一意な識別子を返す。

```javascript
name() { return 'lmstudio'; }
```

#### `defaultModels(): string[]`

デフォルトのモデル名リストを返す。`listModels()` が失敗した場合に使用される。

```javascript
defaultModels() { return ['llama-3.2-8b-instruct', 'mistral-7b-instruct']; }
```

#### `call(req): Promise<{content, model, requestUrl, requestBody}>`

AI リクエストを実行する。

**引数 `req`:**

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `model` | string | モデル名 |
| `userPrompt` | string | ユーザープロンプト |
| `systemPrompt` | string | システムプロンプト（オプション） |
| `temperature` | number | 温度パラメータ（0-2） |
| `maxTokens` | number | 最大トークン数 |
| `attachments` | array | 添付ファイル（画像等） |
| `apiPath` | string | カスタム API パス（オプション） |
| `customParams` | object | カスタムパラメータ |

**戻り値:**

```javascript
{
    content: string,        // AI の応答テキスト
    model: string,          // 使用したモデル名
    requestUrl: string,     // リクエスト URL（ログ用）
    requestBody: string,    // リクエストボディ（ログ用）
    outputAttachments: []   // (任意) 出力の添付ファイル
}
```

#### `listModels(): Promise<string[]>` (任意)

利用可能なモデル一覧を返す。

```javascript
async listModels() {
    const url = this.baseUrl + '/models';
    const raw = await httpRequest(url, 'GET', {}, null);
    const j = JSON.parse(raw);
    return j.data.map(m => m.id);
}
```

#### `testConnection(): Promise<string>`

接続テストを実行する。

- **成功時:** 空文字列 `''` を返す
- **失敗時:** エラーメッセージを返す

```javascript
async testConnection() {
    try {
        const url = this.baseUrl + '/models';
        await httpRequest(url, 'GET', {}, null);
        return '';  // 成功
    } catch (e) {
        return e.message;  // 失敗
    }
}
```

---

## LM Studio API 仕様

LM Studio は OpenAI 互換の REST API を提供する。

### エンドポイント

| エンドポイント | メソッド | 説明 |
|--------------|---------|------|
| `/v1/chat/completions` | POST | チャット完了（メイン API） |
| `/v1/models` | GET | 利用可能なモデル一覧 |
| `/v1/completions` | POST | テキスト完了（レガシー） |

### デフォルト設定

| 項目 | 値 |
|------|-----|
| ホスト | `localhost` |
| ポート | `1234` |
| ベース URL | `http://localhost:1234/v1` |
| API キー | 不要（任意の文字列で可） |

### リクエスト例

```json
POST /v1/chat/completions
Content-Type: application/json

{
    "model": "llama-3.2-8b-instruct",
    "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ],
    "temperature": 0.7,
    "max_tokens": 4096,
    "stream": false
}
```

### レスポンス例

```json
{
    "id": "chatcmpl-xxx",
    "object": "chat.completion",
    "created": 1234567890,
    "model": "llama-3.2-8b-instruct",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "Hello! How can I help you today?"
            },
            "finish_reason": "stop"
        }
    ],
    "usage": {
        "prompt_tokens": 10,
        "completion_tokens": 8,
        "total_tokens": 18
    }
}
```

---

## テスト手順

### 1. LM Studio の準備

```powershell
# LM Studio を起動
# → モデルをダウンロード（例: llama-3.2-8b-instruct）
# → 「Start Server」ボタンでサーバー起動
# → デフォルトポート: 1234
```

### 2. Wend のビルド・起動

```powershell
cd Wend/electron
npm install
npm start
```

### 3. 接続テスト

1. Wend で ⚙ Config を開く
2. 「LM Studio」セクションを確認
3. Base URL が `http://localhost:1234/v1` になっていることを確認
4. 「Test Connection」ボタンをクリック
5. 成功すれば緑のチェックマークが表示される

### 4. レシピ作成・実行テスト

1. Recipe Manager で新規レシピを作成
2. Provider: `lmstudio`
3. Model: LM Studio で読み込んだモデル名
4. プロンプトを入力して実行
5. 結果が正しく返ってくることを確認

---

## トラブルシューティング

### 接続エラー

| 症状 | 原因 | 解決策 |
|------|------|--------|
| `Connection refused` | LM Studio が起動していない | LM Studio を起動してサーバーを開始 |
| `ECONNREFUSED 127.0.0.1:1234` | ポートが異なる | LM Studio の設定でポート確認 |
| `Empty response received` | モデルが読み込まれていない | LM Studio でモデルをダウンロード・ロード |
| `Model not found` | モデル名が一致しない | LM Studio のモデル名を確認して正確に入力 |

### モデル一覧が取得できない

LM Studio の `/v1/models` エンドポイントが正しく動作しているか確認:

```powershell
curl http://localhost:1234/v1/models
```

### パフォーマンス問題

| 症状 | 原因 | 解決策 |
|------|------|--------|
| 応答が遅い | モデルが大きすぎる | より小さいモデルを使用（例: 7B → 3B） |
| メモリ不足 | VRAM/RAM が足りない | クォンタイズ版を使用（Q4_K_M 等） |
| 初回起動が遅い | モデルのロード時間 | 一度ロードすれば以降は速い |

---

## 既存プロバイダーとの比較

| 項目 | OpenAI | Ollama | LM Studio |
|------|--------|--------|-----------|
| 実行場所 | クラウド | ローカル | ローカル |
| API 形式 | OpenAI 独自 | Ollama 独自 | OpenAI 互換 |
| API キー | 必須 | 不要 | 不要 |
| モデル一覧取得 | ✅ | ✅ | ✅ |
| 画像入力 | ✅ | △ | △（モデル依存） |
| オフライン動作 | ❌ | ✅ | ✅ |
| コスト | 従量課金 | 無料 | 無料 |

---

## 実装チェックリスト

- [ ] `electron/providers/lmstudio.js` を作成
- [ ] `electron/main.js` の `builtinProviders` に `lmstudio` を追加
- [ ] `frontend/defaults/appproviders.json` に LM Studio のエントリを追加
- [ ] (任意) `frontend/defaults/recipes-lmstudio.json` を作成
- [ ] LM Studio を起動して接続テスト
- [ ] レシピ作成・実行テスト
- [ ] エラーハンドリングの確認
- [ ] ドキュメントの更新（README 等に LM Studio 対応を明記）

---

## 参考リンク

- [LM Studio 公式サイト](https://lmstudio.ai/)
- [LM Studio API ドキュメント](https://lmstudio.ai/docs/local-server)
- [OpenAI API 仕様](https://platform.openai.com/docs/api-reference)
