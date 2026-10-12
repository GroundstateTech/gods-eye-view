@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 24.14+ ^(24.x^) or 26.x from https://nodejs.org/
  popd
  pause
  exit /b 1
)
node scripts/run-local.mjs %*
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" pause
exit /b %RESULT%
