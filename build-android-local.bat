@echo off
setlocal EnableDelayedExpansion

:: ─── Configuration ────────────────────────────────────────────────────────────
set "PROJECT_ROOT=%~dp0"
set "FRONTEND_DIR=%PROJECT_ROOT%frontend"
set "ANDROID_DIR=%FRONTEND_DIR%\android"
set "APP_DIR=%ANDROID_DIR%\app"
set "OUTPUT_DIR=%PROJECT_ROOT%dist-android"

:: JDK bundled with Android Studio (adjust if installed elsewhere)
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "ANDROID_HOME=C:\Users\aniston user\AppData\Local\Android\Sdk"

:: Add tools to PATH
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

:: ─── 1. Build frontend ─────────────────────────────────────────────────────────
echo.
echo [1/4] Building frontend (Vite)...
cd /d "%FRONTEND_DIR%"
call npm run build
if %ERRORLEVEL% NEQ 0 ( echo FAILED: frontend build && exit /b 1 )

:: ─── 2. Sync Capacitor ─────────────────────────────────────────────────────────
echo.
echo [2/4] Syncing Capacitor to Android...
call npx cap sync android
if %ERRORLEVEL% NEQ 0 ( echo FAILED: cap sync && exit /b 1 )

:: ─── 3. Build APK + AAB ────────────────────────────────────────────────────────
echo.
echo [3/4] Building release APK + AAB...
cd /d "%ANDROID_DIR%"
call gradlew.bat assembleRelease bundleRelease --no-daemon
if %ERRORLEVEL% NEQ 0 ( echo FAILED: Gradle build && exit /b 1 )

:: ─── 4. Copy outputs ───────────────────────────────────────────────────────────
echo.
echo [4/4] Copying outputs to %OUTPUT_DIR%...
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

copy /Y "%APP_DIR%\build\outputs\apk\release\app-release.apk" "%OUTPUT_DIR%\aniston-hrms.apk"
copy /Y "%APP_DIR%\build\outputs\bundle\release\app-release.aab" "%OUTPUT_DIR%\aniston-hrms.aab"

echo.
echo ─────────────────────────────────────────
echo  Build complete!
echo  APK: %OUTPUT_DIR%\aniston-hrms.apk
echo  AAB: %OUTPUT_DIR%\aniston-hrms.aab
echo ─────────────────────────────────────────
endlocal
