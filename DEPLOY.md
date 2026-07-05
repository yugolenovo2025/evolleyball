# eVolleyball 一般公開の手順（Render・無料・マルチ対戦対応）

コード側の準備（`render.yaml` / 本番ビルド設定 / git 初期化）は完了済み。
残るのは「あなたのアカウントでの操作」だけです。GitHub と Render は無料・カード不要。

所要時間: 10〜15分。以降はコードを更新して push するだけで自動再デプロイされます。

---

## STEP 1. GitHub にコードを置く

1. https://github.com/signup で GitHub アカウントを作成（既にあれば飛ばす）
2. https://github.com/new で空のリポジトリを作成
   - Repository name: `evolleyball`
   - **Public**（Render 無料プランは Public 推奨）
   - 「Add a README」などのチェックは**すべて外す**（空で作る）
   - Create repository
3. 作成後に表示される `https://github.com/あなたのID/evolleyball.git` をコピー
4. このフォルダで以下を実行（`!` を付けてこのチャット欄で流せます）:

   ```
   ! git remote add origin https://github.com/あなたのID/evolleyball.git
   ! git push -u origin main
   ```

   初回 push でブラウザ認証（GitHub ログイン）を求められたら許可する。

---

## STEP 2. Render でデプロイ

1. https://render.com/ で「Get Started」→ **GitHub でサインアップ**（連携を許可）
2. ダッシュボードで **New +** → **Web Service**
3. 先ほどの `evolleyball` リポジトリを選択（初回は「Connect account」でGitHubを接続）
4. Render が `render.yaml` を自動検出する。設定はそのままでOK:
   - Runtime: Node / Plan: **Free**
   - Build: `npm install --include=dev && npm run build`
   - Start: `npm run start`
5. **Create Web Service** を押す → 数分でビルド＆公開

完了すると `https://evolleyball-xxxx.onrender.com` のような**永続URL**が発行される。
このURLをスマホ・PC・友達に共有すれば、誰でもアクセスしてソロもマルチも遊べる。

---

## 使い方（公開後）

- ソロ: URLを開いて「試合をはじめる」
- マルチ: 片方が「部屋を作る」→ ルームコードを相手に伝える → 相手はコードで「参加する」
  （サーバーアドレス欄は**空欄のまま**でOK。同じサイトのサーバーに自動接続）

## 更新のしかた

コードを直したら:
```
! git add -A
! git commit -m "更新内容"
! git push
```
push すると Render が自動で再ビルド・再公開する。

## 無料プランの注意

- 15分アクセスが無いとスリープし、次のアクセスで復帰に**30〜60秒**かかる（初回だけ遅い）
- 常時即応にしたい / スリープを無くしたい場合は Render の有料プラン（月$7〜）にアップグレード
