@echo off
rem DropRing komut satiri (Windows). Kurulum bu klasoru PATH'e ekler.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0DropRing.exe" "%~dp0resources\app.asar\src\cli.js" %*
