@echo off
setlocal
cd /d "%~dp0"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8787"
title What-if runner (close this window to stop)
echo.
echo  What-if runner. Leave this window open while you use the page.
echo  Closing this window (or pressing Ctrl+C) stops the runner and any search in progress.
echo.
echo  Opening http://127.0.0.1:%PORT%/ in your default browser in a few seconds...
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start "" http://127.0.0.1:%PORT%/"
"%~dp0node.exe" "%~dp0tools\whatif\runner\server.mjs" --port %PORT%
echo.
echo  The runner stopped. If the message above says EADDRINUSE, something is already using port %PORT%:
echo  close the other runner window (or any other program using that port) and start this again.
echo.
pause
