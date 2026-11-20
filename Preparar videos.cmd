@echo off
rem HomeFlix: abre el Preparador de videos (crea las versiones 4K, 1080p, 720p y 360p para Telegram).
rem Deja esta ventana abierta mientras lo usas; para cerrarlo, cierra la ventana.
title HomeFlix - Preparador de videos
cd /d "%~dp0"
where node >NUL 2>&1 || (echo Falta Node.js: instalalo desde https://nodejs.org y vuelve a intentar. & pause & exit /b 1)
where ffmpeg >NUL 2>&1 || (echo Falta ffmpeg: instalalo desde https://www.gyan.dev/ffmpeg/builds/ y vuelve a intentar. & pause & exit /b 1)
node tools\preparador\server.mjs
pause
