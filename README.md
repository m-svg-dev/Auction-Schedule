# ギルド内オークション入札管理アプリ

複数のギルドで共用できる、オークション入札担当のローテーション管理アプリです。
URLを共有するだけで各ギルドが利用できます。

## 技術構成

- HTML / CSS / JavaScript（Vanilla JS, `type="module"`）
- データ保存は `localStorage`（ギルドごとに分離して保存）
- 将来的に Firebase Authentication + Firestore へ移行しやすいよう、データ操作はすべて [js/storage.js](js/storage.js) に関数化しています

```text
/
├── index.html
├── style.css
├── README.md
├── assets/
└── js/
    ├── app.js        … 画面遷移・イベント処理
    ├── storage.js     … localStorage CRUD（データ層）
    ├── rotation.js    … 入札担当の自動割り当てアルゴリズム
    └── calendar.js    … ISO週番号(YYYY-Www)計算
```

## セットアップ方法

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

## 将来拡張（Firebase対応）

`js/storage.js` の関数群（`registerGuild` / `loginGuild` / `addMember` など）を
Firebase Authentication + Firestore を使った実装に差し替えるだけで、
複数端末同期・本格的な認証に対応できる構成にしています。
