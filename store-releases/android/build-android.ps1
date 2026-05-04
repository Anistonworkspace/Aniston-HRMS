<#
  Build Aniston HRMS -> signed .aab (Android App Bundle) + signed .apk
  Run from ANY directory - script locates everything itself.

  Prerequisites:
    1. Android Studio installed (bundles JDK 17/21)
    2. Copy signing.keystore into this folder
    3. Copy .keystore-env.template -> .keystore-env and fill in passwords

  Output:
    store-releases/android/app-release.aab   (Play Store upload)
    store-releases/android/aniston-hrms.apk  (direct install / sideload)
#>

$ErrorActionPreference = "Stop"

$SCRIPT_DIR  = $PSScriptRoot
$ROOT        = Resolve-Path (Join-Path $SCRIPT_DIR "..\..")
$ANDROID_DIR = Join-Path $ROOT "frontend\android"
$OUTPUT_AAB  = Join-Path $ANDROID_DIR "app\build\outputs\bundle\release\app-release.aab"
$OUTPUT_APK  = Join-Path $ANDROID_DIR "app\build\outputs\apk\release\app-release.apk"
$DEST_AAB    = Join-Path $SCRIPT_DIR "app-release.aab"
$DEST_APK    = Join-Path $SCRIPT_DIR "aniston-hrms.apk"

Write-Host ""
Write-Host "=================================================" -ForegroundColor DarkCyan
Write-Host "  Aniston HRMS  --  Android AAB + APK Build" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor DarkCyan

# -- Step 1: Set JAVA_HOME from Android Studio bundled JDK --
$AS_JDK = "C:\Program Files\Android\Android Studio\jbr"
if (-not (Test-Path $AS_JDK)) {
    Write-Error ("Android Studio JDK not found at: " + $AS_JDK + "`nInstall Android Studio from https://developer.android.com/studio then re-run.")
    exit 1
}
$env:JAVA_HOME = $AS_JDK
$env:PATH      = $AS_JDK + "\bin;" + $env:PATH
Write-Host ("[prereq] JAVA_HOME = " + $AS_JDK) -ForegroundColor Gray

# -- Step 2: Load keystore credentials from .keystore-env --
$KEY_ENV = Join-Path $SCRIPT_DIR ".keystore-env"
if (Test-Path $KEY_ENV) {
    Get-Content $KEY_ENV | ForEach-Object {
        if ($_ -match "^\s*([^#=]+?)\s*=\s*(.+)\s*$") {
            [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
        }
    }
    Write-Host "[prereq] Loaded keystore credentials from .keystore-env" -ForegroundColor Gray
} else {
    Write-Warning ".keystore-env not found. Copy .keystore-env.template -> .keystore-env and fill in passwords."
    exit 1
}

# Default KEYSTORE_PATH if not set
if (-not $env:KEYSTORE_PATH) {
    $env:KEYSTORE_PATH = "signing.keystore"
}

# Resolve keystore: look in script dir first, copy to android/app/ if found
$KS_IN_SCRIPT = Join-Path $SCRIPT_DIR $env:KEYSTORE_PATH
$KS_IN_APP    = Join-Path $ANDROID_DIR ("app\" + $env:KEYSTORE_PATH)
if (Test-Path $KS_IN_SCRIPT) {
    Copy-Item -Force $KS_IN_SCRIPT $KS_IN_APP
    Write-Host "[prereq] Copied keystore to android/app/" -ForegroundColor Gray
} elseif (-not (Test-Path $KS_IN_APP)) {
    Write-Error ("signing.keystore not found. Copy it to: " + $SCRIPT_DIR + "\signing.keystore")
    exit 1
}

# -- Step 3: Build frontend --
Write-Host ""
Write-Host "[1/5] Building frontend..." -ForegroundColor Cyan
Push-Location $ROOT
npm run build --workspace=frontend
if ($LASTEXITCODE -ne 0) { Write-Error "Frontend build failed"; exit 1 }
Pop-Location

# -- Step 4: Sync Capacitor assets --
Write-Host ""
Write-Host "[2/5] Syncing Capacitor assets to android..." -ForegroundColor Cyan
Push-Location (Join-Path $ROOT "frontend")
npx cap sync android
if ($LASTEXITCODE -ne 0) { Write-Error "Capacitor sync failed"; exit 1 }
Pop-Location

# -- Step 5: Gradle bundleRelease + assembleRelease --
Write-Host ""
Write-Host "[3/5] Running Gradle bundleRelease + assembleRelease..." -ForegroundColor Cyan
Write-Host "      (first run downloads Gradle ~200MB, takes a few minutes)" -ForegroundColor Gray
Push-Location $ANDROID_DIR
.\gradlew.bat bundleRelease assembleRelease
if ($LASTEXITCODE -ne 0) { Write-Error "Gradle build failed"; exit 1 }
Pop-Location

# -- Step 6: Copy AAB --
Write-Host ""
Write-Host "[4/5] Copying signed AAB to store-releases/android/..." -ForegroundColor Cyan
if (-not (Test-Path $OUTPUT_AAB)) {
    Write-Error ("Expected AAB not found at: " + $OUTPUT_AAB)
    exit 1
}
Copy-Item -Force $OUTPUT_AAB $DEST_AAB
$AAB_SIZE = [math]::Round((Get-Item $DEST_AAB).Length / 1MB, 1)
Write-Host ("  AAB: " + $DEST_AAB + " (" + $AAB_SIZE + " MB)") -ForegroundColor Green

# -- Step 7: Copy APK --
Write-Host ""
Write-Host "[5/5] Copying signed APK to store-releases/android/..." -ForegroundColor Cyan
if (-not (Test-Path $OUTPUT_APK)) {
    Write-Error ("Expected APK not found at: " + $OUTPUT_APK)
    exit 1
}
Copy-Item -Force $OUTPUT_APK $DEST_APK
$APK_SIZE = [math]::Round((Get-Item $DEST_APK).Length / 1MB, 1)
Write-Host ("  APK: " + $DEST_APK + " (" + $APK_SIZE + " MB)") -ForegroundColor Green

# -- Done --
Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  BUILD SUCCESSFUL  --  v1.2.0 (versionCode 12)" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  AAB  -> Upload to Play Console for production release" -ForegroundColor Yellow
Write-Host "  APK  -> Direct install / sideload / EC2 download" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Play Console: https://play.google.com/console" -ForegroundColor Gray
Write-Host "  Production > Releases > Create new release > Upload AAB" -ForegroundColor Gray
Write-Host ""
