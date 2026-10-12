@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24.14+ ^(24.x^) or 26.x from https://nodejs.org/ first.
  popd
  pause
  exit /b 1
)
node scripts/run-local.mjs --traceroot %*
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" pause
exit /b %RESULT%
