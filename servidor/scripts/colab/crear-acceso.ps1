# HomeFlix: prepara en el VPS el acceso del colaborador «deploycolab» (solo actualizaciones). Se corre desde este PC, en una terminal:
#   & ".\servidor\scripts\colab\crear-acceso.ps1"                       crea el usuario y deja una llave de PRUEBA que vence a los 30 minutos
#   & ".\servidor\scripts\colab\crear-acceso.ps1" -Clave "ssh-ed25519 AAAA… nombre"   deja SOLO la llave del colaborador (reemplaza las anteriores)
#   & ".\servidor\scripts\colab\crear-acceso.ps1" -Quitar               le quita todo el acceso
#   agrega -Root si no se recuerda la contraseña de sudo de deploy: entonces pide la contraseña de ROOT (con su), también aquí en la terminal
# Sube los dos archivos a ~/homeflix-colab-instalar del usuario deploy y corre crear-colaborador.sh con privilegios: el VPS pide la contraseña AQUÍ,
# en esta terminal (la escribe el dueño; este script nunca la ve ni la guarda).
param([string]$Clave = "", [string]$ClaveArchivo = "", [switch]$Quitar, [switch]$Root)
$ErrorActionPreference = "Stop"
if ($ClaveArchivo -ne "") { $Clave = (Get-Content $ClaveArchivo -Raw).Trim() }   # -ClaveArchivo ruta.pub: lee la llave pública de un archivo
$vps = "deploy@187.77.20.217"
$llave = Join-Path $env:USERPROFILE ".ssh\nexuspos_vps"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$ssh = @("-i", $llave, "-o", "ConnectTimeout=20")
$prueba = Join-Path $env:USERPROFILE ".ssh\homeflix_colab_prueba"
$script = "bash /home/deploy/homeflix-colab-instalar/crear-colaborador.sh"

Write-Host "`n== Subiendo los archivos a ~/homeflix-colab-instalar (usuario deploy)" -ForegroundColor Cyan
& ssh @ssh -o BatchMode=yes $vps "mkdir -p ~/homeflix-colab-instalar"
& scp @ssh -o BatchMode=yes (Join-Path $aqui "homeflix-colab") (Join-Path $aqui "crear-colaborador.sh") "${vps}:~/homeflix-colab-instalar/"

if ($Quitar) {
  $args_sh = "--quitar"
} elseif ($Clave -ne "") {
  $args_sh = "--reemplazar --clave '$Clave'"
} else {
  # llave de prueba: solo para comprobar que el acceso funciona de verdad por SSH; vence sola a los 30 minutos
  if (-not (Test-Path $prueba)) { & ssh-keygen -q -t ed25519 -N '""' -f $prueba -C "homeflix-colab-prueba" }
  $pub = (Get-Content "$prueba.pub" -Raw).Trim()
  $vence = (Get-Date).ToUniversalTime().AddMinutes(30).ToString("yyyyMMddHHmm") + "Z"
  $args_sh = "--reemplazar --vence $vence --clave '$pub'"
}

# La orden va en un archivo (sin comillas anidadas por el camino): se sube y se ejecuta con sudo o con su.
$tmp = Join-Path $env:TEMP "homeflix-ejecutar.sh"
[System.IO.File]::WriteAllText($tmp, "#!/bin/bash`nset -e`n$script $args_sh`n", (New-Object System.Text.UTF8Encoding($false)))
& scp @ssh -o BatchMode=yes $tmp "${vps}:~/homeflix-colab-instalar/ejecutar.sh"
& ssh @ssh -o BatchMode=yes $vps "chmod 700 ~/homeflix-colab-instalar/ejecutar.sh"
Remove-Item $tmp -Force

if ($Root) {
  $orden = "su - -c /home/deploy/homeflix-colab-instalar/ejecutar.sh"
  $pide = "la contraseña de ROOT (Password:)"
} else {
  $orden = "sudo bash /home/deploy/homeflix-colab-instalar/ejecutar.sh"
  $pide = "la contraseña de sudo de deploy ([sudo] password)"
}
Write-Host "`n== En el VPS: $orden" -ForegroundColor Cyan
Write-Host "   (cuando pida $pide, escríbela aquí y pulsa Enter; no se ve al escribirla)`n" -ForegroundColor Yellow
& ssh @ssh -t $vps $orden
Write-Host "`nListo. Cierra esta pestaña cuando termine." -ForegroundColor Green
