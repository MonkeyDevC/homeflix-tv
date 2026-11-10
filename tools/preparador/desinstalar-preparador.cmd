<# : HomeFlix - quita el Preparador de videos de este PC (lo abre «Aplicaciones instaladas» de Windows). Abajo es PowerShell.
@echo off
title HomeFlix - desinstalar el Preparador de videos
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:HF_DESINSTALADOR='%~f0'; iex (${%~f0} | Out-String)"
goto :EOF
#>
# Quita los accesos directos, la entrada de «Aplicaciones instaladas» y la carpeta del preparador.
# Los videos y las versiones que creaste (en sus propias carpetas) no se tocan.
$ErrorActionPreference = 'Stop'
$yo = $env:HF_DESINSTALADOR
$Destino = (Resolve-Path (Join-Path (Split-Path -Parent $yo) '..\..')).Path
Add-Type -AssemblyName PresentationFramework
$r = [System.Windows.MessageBox]::Show("Quitar el Preparador de videos de HomeFlix de este PC?`n`nCarpeta: $Destino`n`nTus videos y las versiones que creaste no se borran.", 'HomeFlix Preparador', 'YesNo', 'Question')
if ($r -ne 'Yes') { exit }
try {
  foreach ($l in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'HomeFlix Preparador.lnk'))) { if (Test-Path -LiteralPath $l) { Remove-Item -LiteralPath $l -Force } }
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'HomeFlix'
  if (Test-Path -LiteralPath $menu) { Remove-Item -LiteralPath $menu -Recurse -Force }
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HomeFlixPreparador'
  if (Test-Path $key) { Remove-Item $key -Recurse -Force }
  # la carpeta se borra cuando este script termina (no se puede borrar a si misma mientras corre)
  Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c timeout /t 2 /nobreak >nul & rd /s /q "' + $Destino + '"') -WindowStyle Hidden
  [System.Windows.MessageBox]::Show('Listo: el Preparador de videos se quito de este PC.', 'HomeFlix Preparador') | Out-Null
} catch {
  [System.Windows.MessageBox]::Show('No se pudo desinstalar: ' + $_.Exception.Message, 'HomeFlix Preparador') | Out-Null
}
