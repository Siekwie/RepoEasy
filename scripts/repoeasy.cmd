@echo off
rem Starts the local single-user RepoEasy instance and opens it in the browser.
rem Uses GITHUB_TOKEN from .env if present, otherwise the GitHub CLI's token.
setlocal
cd /d "%~dp0.."
if not exist node_modules call npm install
if not exist dist\server.mjs call npm run build
if not defined GITHUB_TOKEN findstr /b /c:"GITHUB_TOKEN=" .env >nul 2>&1 || for /f "delims=" %%t in ('gh auth token') do set "GITHUB_TOKEN=%%t"
if not defined PORT set PORT=8787
start "" http://localhost:%PORT%
node dist\server.mjs
