@echo off
setlocal
chcp 65001 >nul
set "XXT_NODE=node"
where node >nul 2>&1
if errorlevel 1 set "XXT_NODE=%ProgramFiles%\nodejs\node.exe"
if not "%XXT_NODE%"=="node" if not exist "%XXT_NODE%" (
  echo Node.js 22 or later is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
"%XXT_NODE%" "%~dp0scripts\start-learning.cjs" %*
if errorlevel 1 pause
