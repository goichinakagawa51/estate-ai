# EstateAI — Netlify デプロイ手順

## フォルダ構成

```
estate-ai-netlify/
├── netlify.toml                  # ビルド・リダイレクト設定
├── netlify/
│   └── functions/
│       └── estimate.js           # 国交省APIプロキシ (Netlify Function)
└── public/
    └── index.html                # フロントエンド
```

---

## デプロイ手順（所要時間 約10分）

### Step 1: GitHubにリポジトリを作成してアップロード

```bash
git init
git add .
git commit -m "EstateAI initial commit"
git remote add origin https://github.com/YOUR_NAME/estate-ai.git
git push -u origin main
```

### Step 2: Netlifyに接続

1. https://app.netlify.com にログイン
2. 「Add new site」→「Import an existing project」
3. GitHubを選択 → リポジトリを選択
4. ビルド設定は **netlify.toml が自動で読み込まれる** のでそのまま「Deploy」

### Step 3: 環境変数にAPIキーを設定（最重要）

Netlifyダッシュボード上で:

```
Site configuration → Environment variables → Add a variable

キー名 : REINFOLIB_API_KEY
値     : （国交省から取得したAPIキー）
```

設定後「Trigger deploy」でサイトを再デプロイすれば完了。

### Step 4: 動作確認

デプロイされたURL（例: `https://estate-ai-xxxxx.netlify.app`）にアクセスし、
住所と面積を入力して査定を実行。

---

## 動作の仕組み

```
ブラウザ
  └─ POST /api/estimate
       │
       │  netlify.toml でリダイレクト
       ▼
Netlify Function (estimate.js)
  └─ 環境変数からAPIキーを読み込み
  └─ 国交省API (reinfolib.mlit.go.jp) へリクエスト
  └─ データを正規化してブラウザに返却
```

APIキーはサーバーサイド（Netlify Function内）でのみ使用されるため、
フロントエンドに露出しません。

---

## APIキー未設定時の挙動

`REINFOLIB_API_KEY` が未設定の場合、Netlify Functionは
自動的にモックデータを返します。デプロイ直後でも画面が壊れません。

---

## カスタムドメインの設定（任意）

Netlifyダッシュボード:
```
Domain management → Add a domain
```
独自ドメインを設定するとSSL証明書も自動発行されます。

---

## 国交省API申請先

https://www.reinfolib.mlit.go.jp/api/request/
- 無料
- 審査: 5営業日以内
- 個人・法人どちらでも申請可能
