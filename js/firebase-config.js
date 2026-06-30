// Firebase の初期化設定
//
// セットアップ手順:
// 1. https://console.firebase.google.com で新規プロジェクトを作成する
// 2. 左メニュー「Firestore Database」を開き、データベースを作成する（本番モードでOK。
//    セキュリティルールは firestore.rules の内容を「ルール」タブに貼り付けて公開する）
// 3. 「プロジェクトの概要」歯車アイコン → プロジェクトの設定 → 「マイアプリ」で
//    ウェブアプリ（</>アイコン）を追加し、表示される firebaseConfig の値を下記に貼り付ける
//
// 補足: ここに書く apiKey 等はサーバーの秘密鍵ではなく、Webアプリ識別用の公開値です。
// 公開リポジトリにコミットしても問題ありません（アクセス制御は Firestore のルール側で行います）。

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCT6JBoTaWSgRQG0RzXkJpPxAz1yFwhlIc',
  authDomain: 'auction-schedule.firebaseapp.com',
  projectId: 'auction-schedule',
  storageBucket: 'auction-schedule.firebasestorage.app',
  messagingSenderId: '176644868860',
  appId: '1:176644868860:web:d75d067e5b8dcd1d312579',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
