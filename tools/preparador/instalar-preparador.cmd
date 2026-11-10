<# : HomeFlix - instala el Preparador de videos en este PC (doble clic). La parte de abajo es PowerShell.
@echo off
title HomeFlix - instalar el Preparador de videos
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (${%~f0} | Out-String)"
echo.
pause
goto :EOF
#>
# Instala (o reinstala) el Preparador de videos de HomeFlix:
#   1. Node.js y ffmpeg, si faltan (con winget, el instalador de Windows).
#   2. Baja la ultima version del canal de actualizaciones de HomeFlix y revisa que llego completa (sha256).
#   3. La deja en %LOCALAPPDATA%\HomeFlix\Preparador (el .env con las claves de este PC se conserva).
#   4. Crea los accesos directos «HomeFlix Preparador» en el escritorio y en el menu Inicio, y lo abre.
# Despues se actualiza solo desde su propio aviso «Version nueva». Variables para pruebas: HF_UPDATES, HF_DESTINO, HF_SIN_ACCESOS, HF_NO_ABRIR.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Canal = if ($env:HF_UPDATES) { $env:HF_UPDATES } else { 'https://scalvache.shop/productos/HomeFlix/actualizaciones' }
$Destino = if ($env:HF_DESTINO) { $env:HF_DESTINO } else { Join-Path $env:LOCALAPPDATA 'HomeFlix\Preparador' }

function Paso($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Yellow }
function Tiene($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function RecargarPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

try {
  Write-Host 'HomeFlix - Preparador de videos' -ForegroundColor Cyan

  Paso 'Revisando Node.js y ffmpeg'
  foreach ($p in @(@{ c = 'node'; id = 'OpenJS.NodeJS.LTS'; n = 'Node.js' }, @{ c = 'ffmpeg'; id = 'Gyan.FFmpeg'; n = 'ffmpeg' })) {
    if (Tiene $p.c) { Write-Host "  $($p.n): listo"; continue }
    if (-not (Tiene 'winget')) { throw "Falta $($p.n) y este Windows no tiene winget. Instala $($p.n) a mano y vuelve a abrir este instalador." }
    Write-Host "  Instalando $($p.n)... (Windows puede pedir permiso)"
    winget install -e --id $p.id --accept-source-agreements --accept-package-agreements --silent | Out-Host
    RecargarPath
    if (-not (Tiene $p.c)) { throw "No pude instalar $($p.n). Instalalo a mano y vuelve a abrir este instalador." }
  }

  Paso 'Bajando la ultima version'
  $m = Invoke-RestMethod -Uri "$Canal/v1" -UseBasicParsing
  if (-not $m.preparador) { throw 'El canal de HomeFlix todavia no tiene el preparador.' }
  $zip = Join-Path $env:TEMP ("homeflix-preparador-" + $m.version + ".zip")
  Invoke-WebRequest -Uri ("$Canal/archivos/" + $m.version + "/" + $m.preparador.archivo) -OutFile $zip -UseBasicParsing
  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $m.preparador.sha256) { throw 'La descarga llego danada. Vuelve a abrir el instalador.' }
  Write-Host ("  Version " + $m.version + ": lista")

  Paso "Instalando en $Destino"
  New-Item -ItemType Directory -Force -Path $Destino | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  & $tar -x -f $zip -C $Destino
  if ($LASTEXITCODE -ne 0) { throw 'No pude abrir el paquete del preparador.' }
  Remove-Item -LiteralPath $zip -Force

  if (-not $env:HF_SIN_ACCESOS) {
  Paso 'Creando los accesos directos'
  $ws = New-Object -ComObject WScript.Shell
  $inicio = Join-Path ([Environment]::GetFolderPath('Programs')) 'HomeFlix'
  New-Item -ItemType Directory -Force -Path $inicio | Out-Null
  foreach ($dir in @([Environment]::GetFolderPath('Desktop'), $inicio)) {
    $l = $ws.CreateShortcut((Join-Path $dir 'HomeFlix Preparador.lnk'))
    $l.TargetPath = Join-Path $Destino 'Preparar videos.cmd'
    $l.WorkingDirectory = $Destino
    $l.IconLocation = (Join-Path $Destino 'tools\preparador\logo.ico') + ',0'
    $l.Description = 'Prepara y publica las peliculas de HomeFlix'
    $l.Save()
  }
  }

  Paso 'Registrando en Aplicaciones instaladas'
  # como cualquier programa: aparece en Configuracion > Aplicaciones (solo para este usuario, sin pedir administrador)
  if (-not $env:HF_SIN_ACCESOS) {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\HomeFlixPreparador'
    New-Item -Path $key -Force | Out-Null
    $kb = [int]((Get-ChildItem -LiteralPath $Destino -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1KB)
    $vals = @{ DisplayName = 'HomeFlix Preparador de videos'; DisplayVersion = [string]$m.version; Publisher = 'HomeFlix';
      DisplayIcon = (Join-Path $Destino 'tools\preparador\logo.ico'); InstallLocation = $Destino;
      UninstallString = ('cmd.exe /c "' + (Join-Path $Destino 'tools\preparador\desinstalar-preparador.cmd') + '"');
      InstallDate = (Get-Date -Format 'yyyyMMdd'); URLInfoAbout = 'https://scalvache.shop/productos/HomeFlix' }
    foreach ($k in $vals.Keys) { New-ItemProperty -Path $key -Name $k -Value $vals[$k] -PropertyType String -Force | Out-Null }
    foreach ($k in @('NoModify', 'NoRepair')) { New-ItemProperty -Path $key -Name $k -Value 1 -PropertyType DWord -Force | Out-Null }
    New-ItemProperty -Path $key -Name EstimatedSize -Value $kb -PropertyType DWord -Force | Out-Null
    Write-Host "  Listo: aparece en Configuracion > Aplicaciones como 'HomeFlix Preparador de videos'."
  }

  Paso 'Listo'
  Write-Host '  Abriendo el preparador... La primera vez te pide las claves de Telegram y de TMDB de este PC.'
  if (-not $env:HF_NO_ABRIR) { Start-Process -FilePath (Join-Path $Destino 'Preparar videos.cmd') -WorkingDirectory $Destino }
} catch {
  Write-Host ''
  Write-Host ('No se pudo instalar: ' + $_.Exception.Message) -ForegroundColor Red
}
