@echo off
cd /d "%~dp0"
echo ========================================================
echo    SquadWave - Push commits to GitHub repository
echo ========================================================
git push origin main
echo.
if %errorlevel% equ 0 (
    echo [OK] Push completed successfully!
) else (
    echo [ERROR] Push failed. Check your GitHub credentials.
)
echo.
pause
