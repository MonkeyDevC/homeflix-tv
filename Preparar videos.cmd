@echo off
rem HomeFlix: abre el Preparador de videos (crea las versiones 4K, 1080p, 720p y 360p para Telegram).
rem Deja esta ventana abierta mientras lo usas; para cerrarlo, cierra la ventana.
title HomeFlix - Preparador de videos
cd /d "%~dp0"
where node >NUL 2>&1 || (echo Falta Node.js: instalalo desde https://nodejs.org y vuelve a intentar. & pause & exit /b 1)
where ffmpeg >NUL 2>&1 || (echo Falta ffmpeg: instalalo desde https://www.gyan.dev/ffmpeg/builds/ y vuelve a intentar. & pause & exit /b 1)
rem Al actualizarse, el preparador sale con el codigo 3 y se vuelve a abrir aqui mismo con la version nueva.
set HF_LAUNCHER=1
:abrir
node tools\preparador\server.mjs %*
if %errorlevel%==3 goto abrir
if errorlevel 1 pause
