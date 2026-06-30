# ギルド内オークション入札管理アプリ

複数のギルドで共用できる、オークション入札担当のローテーション管理アプリです。
URLを共有するだけで各ギルドが利用できます。

## 技術構成

- HTML / CSS / JavaScript（Vanilla JS, `type="module"`）
- データベース：**Firebase Firestore**（ギルド単位でドキュメントを分離して保存。複数端末・複数人でURLを共有して利用できます）
- 認証：簡易ログイン（ギルド名 + パスワード。Firebase Authenticationは未使用）
- `localStorage` は「最後にログインしたギルド名」など端末固有の補助情報のみに使用（メインデータには使用しません）

```text
/
├── index.html
├── style.css
├── README.md
├── firestore.rules        … Firestore セキュリティルール（Firebaseコンソールに貼り付ける）
├── assets/
└── js/
    ├── app.js              … 画面遷移・イベント処理
    ├── firebase-config.js  … Firebase初期化設定（要：自分のプロジェクトの値に書き換え）
    ├── storage.js          … Firestore CRUD（データ層）
    ├── rotation.js         … 入札担当の自動割り当てアルゴリズム
    └── calendar.js         … ISO週番号(YYYY-Www)計算
```

## セットアップ方法

### 1. Firebaseプロジェクトの準備

1. https://console.firebase.google.com で新規プロジェクトを作成
2. 左メニュー「Firestore Database」を開き、データベースを作成（リージョンは任意、本番モードでOK）
3. 「Firestore Database」→「ルール」タブを開き、[firestore.rules](firestore.rules) の内容を貼り付けて公開
4. プロジェクト設定（歯車アイコン）→「マイアプリ」→ウェブアプリ（`</>`）を追加し、表示された `firebaseConfig` の値を [js/firebase-config.js](js/firebase-config.js) の該当箇所に貼り付ける

> `apiKey` などの値はサーバーの秘密鍵ではなく、Webアプリ識別用の公開値です。公開リポジトリにコミットしても問題ありません。

### 2. アプリの起動

ビルド不要です。リポジトリをクローンして、静的ファイルとして配信するだけで動作します。

```bash
git clone <このリポジトリのURL>
cd Auction-Schedule
python -m http.server 8000   # 例：簡易サーバーで起動
# http://localhost:8000 をブラウザで開く
```

`index.html` をブラウザで直接開く場合、`type="module"` のESモジュール読み込みが
ブラウザのファイルアクセス制限で動かないことがあるため、ローカルサーバー経由での起動を推奨します。

## GitHub Pages公開方法

1. GitHubリポジトリの **Settings → Pages** を開く
2. Source を `Deploy from a branch` に設定
3. Branch を `main` / `/(root)` に設定して保存
4. 数分後、`https://<ユーザー名>.github.io/<リポジトリ名>/` で公開される

## 利用方法

1. **新規登録**：ギルド名とパスワードでギルド専用のデータ領域を作成
2. **ログイン**：登録したギルド名とパスワードでログイン
3. **役割選択**：管理者 / メンバー を選択（初期版ではUI切替のみ）
4. **管理者**：メンバー登録・アイテム登録・イン不可管理・自動割り当てを実行
5. **メンバー**：自分の担当確認・カレンダー閲覧・イン不可申請

### 自動割り当てルール

- メンバーの登録順に巡回して割り当て
- アイテムは優先順位の高い順に、設定した枠数分だけ割り当て
- イン不可のメンバーはその週スキップし、次回最優先で繰り越し
- 同じ人が連続で割り当てられることは可能な限り回避（他に候補がいない場合のみ例外的に許可）

## セキュリティ上の注意（MVP時点の制約）

このアプリは Firebase Authentication を使わず、ギルド名+パスワードによる簡易ログインを
クライアント側で検証する設計です（パスワードは平文ではなく SHA-256 ハッシュで保存）。
そのため [firestore.rules](firestore.rules) は「ギルド名を知っている人なら誰でも読み書き可能」な
オープンなルールになっており、メンバー一覧やオークション結果などのデータ自体は保護されません。

より強固なアクセス制御が必要になった場合は、Firebase Authentication（匿名認証 + カスタムクレーム等）や
Cloud Functions 経由の検証レイヤーへの移行を検討してください。
