@echo off
rem Opens RepoEasy in the browser. The instance that archives traffic runs on the server (see deploy\).
rem "repoeasy local" starts a single-user instance on this machine instead, on the data in .\data.
rem It uses GITHUB_TOKEN from .env if present, otherwise the GitHub CLI's token.
setlocal
if /i not "%~1"=="local" (
  start "" https://repoeasy.wiest-lab.eu
  exit /b 0
)
cd /d "%~dp0.."
if not exist node_modules call npm install
if not exist dist\server.mjs call npm run build
if not defined GITHUB_TOKEN findstr /b /c:"GITHUB_TOKEN=" .env >nul 2>&1 || for /f "delims=" %%t in ('gh auth token') do set "GITHUB_TOKEN=%%t"
if not defined PORT set PORT=8787
start "" http://localhost:%PORT%
node dist\server.mjs
