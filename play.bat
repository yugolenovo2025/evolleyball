@echo off
rem eVolleyball ワンクリック起動: ビルドしてサーバーを立ち上げ、ブラウザを開く
cd /d "%~dp0"
call npm run build
start "" http://localhost:8787
call npx tsx src/server/server.ts
