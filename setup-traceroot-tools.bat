@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
where py >nul 2>&1
if not errorlevel 1 (
  py -3 scripts/traceroot/setup-tools.py
  goto finish
)
where python >nul 2>&1
if errorlevel 1 (
  echo Install Python 3.10+ first, including the Python launcher or PATH option.
  popd
  pause
  exit /b 1
)
python scripts/traceroot/setup-tools.py
:finish
set "RESULT=%ERRORLEVEL%"
popd
pause
exit /b %RESULT%
