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
"%~dp0node.exe" "%~dp0tools\whatif\runner\server.mjs" --port %PORT% --open
if %errorlevel%==3 (
    echo.
    echo  Nothing was started: the runner was already running. Use the page that just opened, and close this window.
    echo.
    pause
    exit /b 0
)
if %errorlevel%==4 (
    echo.
    echo  Nothing was started: a runner of another version is already running on port %PORT%.
    echo  Close the other runner's window ^(or stop it^), then start this again.
    echo.
    pause
    exit /b 0
)
echo.
echo  The runner stopped. If the message above says EADDRINUSE, something that is not the runner is using port %PORT%:
echo  close that program (or start this again with another port, for example: start-runner.cmd 8788).
echo.
pause
