@echo off
REM Windows: double-click to start. Installs on first run, opens the dashboard, runs all night.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Opening the download page - install the LTS version, then double-click this again. & start "" "https://nodejs.org/en/download" & pause & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" || (echo Node.js is too old - Grok Bot needs 22.13 or newer. & start "" "https://nodejs.org/en/download" & pause & exit /b 1)
if not exist node_modules (call npm install --no-audit --no-fund || (pause & exit /b 1))
REM keep the PC awake while this window is open
powercfg /requestsoverride PROCESS node.exe SYSTEM DISPLAY >nul 2>nul
start "" cmd /c "timeout /t 6 >nul & start http://127.0.0.1:8787"
call npm run night
pause
