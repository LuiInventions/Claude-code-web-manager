@echo off
setlocal
title Claude Code Control Center

rem In das Projektverzeichnis wechseln (Ordner dieser .bat)
cd /d "%~dp0"

rem Standard-Adresse (siehe lib/config.ts; via HOST/PORT in .env ueberschreibbar)
set "HOST_ADDR=127.0.0.1"
set "PORT_ADDR=3100"
set "URL=http://%HOST_ADDR%:%PORT_ADDR%"

rem Dependencies installieren, falls node_modules fehlt
if not exist "node_modules" (
    echo Installiere Dependencies ^(npm install^) ...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install fehlgeschlagen.
        pause
        exit /b 1
    )
)

echo.
echo   Claude Code Control Center wird gestartet ...
echo   URL: %URL%
echo.

rem Browser nach kurzer Verzoegerung oeffnen (parallel, damit der Server zuerst hochfaehrt)
start "" /b cmd /c "timeout /t 5 /nobreak >nul & start "" %URL%"

rem Dev-Server im Vordergrund starten (Fenster zeigt die Server-Logs; mit Strg+C beenden)
call npm run dev

endlocal
