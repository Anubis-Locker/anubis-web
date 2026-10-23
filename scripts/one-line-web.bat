@echo off
rem One-line installer for Anubis-Security-Tool web (build from source, Windows).
rem Optional env vars:
rem   ANUBIS_REPO_URL  git url (default https://github.com/Anubis-Locker/anubis-web.git)
rem   ANUBIS_REF       branch/tag (default: repo default branch)
rem   ANUBIS_DIR       target dir (default anubis-web)
setlocal EnableExtensions

if not defined ANUBIS_REPO_URL set "ANUBIS_REPO_URL=https://github.com/Anubis-Locker/anubis-web.git"
if not defined ANUBIS_DIR set "ANUBIS_DIR=anubis-web"

where git >nul 2>&1 || (echo [anubis] ERROR: git is required. & exit /b 1)
where node >nul 2>&1 || (echo [anubis] ERROR: Node.js 24+ is required. & exit /b 1)
where npm >nul 2>&1 || (echo [anubis] ERROR: npm is required. & exit /b 1)

for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 24 (echo [anubis] ERROR: Node.js 24+ required, found major %NODE_MAJOR%. & exit /b 1)

if exist "%ANUBIS_DIR%\.git" (
  echo [anubis] updating existing checkout in %ANUBIS_DIR%
  git -C "%ANUBIS_DIR%" fetch --tags --prune origin || (echo [anubis] ERROR: git fetch failed. & exit /b 1)
  if defined ANUBIS_REF git -C "%ANUBIS_DIR%" checkout "%ANUBIS_REF%" || (echo [anubis] ERROR: checkout failed. & exit /b 1)
  git -C "%ANUBIS_DIR%" pull --ff-only
) else if exist "%ANUBIS_DIR%" (
  echo [anubis] ERROR: %ANUBIS_DIR% exists and is not a git checkout; set ANUBIS_DIR. & exit /b 1
) else (
  echo [anubis] cloning %ANUBIS_REPO_URL%
  if defined ANUBIS_REF (
    git clone --depth 1 --branch "%ANUBIS_REF%" "%ANUBIS_REPO_URL%" "%ANUBIS_DIR%" || (echo [anubis] ERROR: clone failed. & exit /b 1)
  ) else (
    git clone --depth 1 "%ANUBIS_REPO_URL%" "%ANUBIS_DIR%" || (echo [anubis] ERROR: clone failed. & exit /b 1)
  )
)

cd /d "%ANUBIS_DIR%" || (echo [anubis] ERROR: cannot enter %ANUBIS_DIR%. & exit /b 1)

if not exist .env (
  if not exist .sample.env (echo [anubis] ERROR: .sample.env missing. & exit /b 1)
  copy /y .sample.env .env >nul
  rem generate strong secrets (uses node's crypto) and write them into .env
  node -e "const c=require('crypto'),fs=require('fs');const s=c.randomBytes(32).toString('hex'),p=c.randomBytes(15).toString('base64url');let t=fs.readFileSync('.env','utf8').replace(/^SERVER_SECRET=.*$/m,'SERVER_SECRET='+s).replace(/^SERVER_PASS=.*$/m,'SERVER_PASS='+p);fs.writeFileSync('.env',t);console.log('[anubis] created .env; login user: admin, password: '+p)" || (echo [anubis] ERROR: could not generate .env. & exit /b 1)
) else (
  echo [anubis] .env already exists, leaving it untouched
)

echo [anubis] installing dependencies
call npm install --legacy-peer-deps || (echo [anubis] ERROR: npm install failed. & exit /b 1)
echo [anubis] building
call npm run build || (echo [anubis] ERROR: npm run build failed. & exit /b 1)

echo [anubis] done. Start with: cd %ANUBIS_DIR% ^&^& npm run prod   (http://127.0.0.1:5577)
endlocal
exit /b 0
