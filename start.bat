@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   היומן של יחיאל - מריץ שרת מקומי על פורט 8777
echo   סגירת החלון הזה מכבה את הדשבורד.
echo.
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:8777/"
python -m http.server 8777 --bind 127.0.0.1
