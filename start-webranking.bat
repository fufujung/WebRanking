@echo off
title WebRanking server
rem Double-click to start the website, API and Discord bot.
rem Works from inside the project folder, or from anywhere if the project is at F:\coding\WebRanking-main
if exist "%~dp0package.json" (cd /d "%~dp0") else (cd /d "F:\coding\WebRanking-main")
if not exist package.json (
  echo Project folder not found. Put this file inside the WebRanking-main folder.
  pause
  exit /b 1
)
echo Checking packages...
call npm install --no-audit --no-fund
echo.
echo Starting... open http://localhost:3000 when you see "Ready". Keep this window open.
echo.
call npm run dev
pause
