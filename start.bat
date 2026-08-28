@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ==============================================
echo  デュエル・マスターズ プレイス 配信ツール
echo ==============================================
echo.

where node > nul 2>&1
if errorlevel 1 (
  echo [エラー] Node.js が見つかりません。
  echo https://nodejs.org/ja から LTS 版をインストールしてください。
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 初回セットアップ中です。少し時間がかかります...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [エラー] npm install に失敗しました。
    pause
    exit /b 1
  )
  echo.
)

echo ブラウザで管理画面を開きます...
start "" http://localhost:3000/admin
call npm start

pause
