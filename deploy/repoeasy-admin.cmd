@echo off
rem Opens the RepoEasy admin interface (src/server/admin-web.ts) in your browser.
rem
rem The interface has no login. It listens only on the server's own loopback, and the SSH
rem tunnel this script opens (your SSH key) is the only way in. The tunnel stays open while
rem this window does; Ctrl+C or closing the window closes it.
rem
rem   repoeasy-admin [local port] [ssh host]      defaults: 8793 wiestlab
setlocal
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8793"
set "SSH_HOST=%~2"
if "%SSH_HOST%"=="" set "SSH_HOST=wiestlab"

echo RepoEasy admin: http://localhost:%PORT%/
echo The tunnel stays open while this window does. Ctrl+C closes it.

rem the browser opens a moment later, when the tunnel is up
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:%PORT%/"
ssh -N -o ExitOnForwardFailure=yes -L %PORT%:127.0.0.1:8793 %SSH_HOST%
