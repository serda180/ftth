<#
.SYNOPSIS
  Instala y administra la Plataforma FTTH en Windows 10/11 (sin Docker).

.DESCRIPTION
  Lo normal es no usar este script a mano: INSTALAR.cmd lo ejecuta y deja accesos
  directos en el escritorio y en el menú Inicio ("Plataforma FTTH").

  Uso:  powershell -ExecutionPolicy Bypass -File ftth.ps1 <accion> [opciones]

  Acciones:
    instalar            Instala o repara (conserva datos y claves). Opción: -Demo (red de ejemplo)
    estado              Servicios, direcciones de acceso y certificado
    crear-usuario       Crea un usuario con contraseña y rol
    respaldar           Respaldo de base de datos, fotos y configuración. Opción: -Destino <carpeta>
    restaurar <archivo> Restaura un respaldo .dump (y sus fotos, si están junto a él)
    programar-respaldo  Respaldo diario automático. Opción: [HH:mm] (por defecto 13:00)
    actualizar          Respalda y aplica una versión nueva descomprimida sobre la carpeta
    correo              Configura el servidor de correo (invitaciones y recuperación)
    borrar-demo         Borra los datos de demostración (solo lo marcado como DEMO)
    reiniciar | detener | iniciar
    logs                Últimas líneas de los registros
    desinstalar         Quita servicios, accesos y firewall (pregunta antes de borrar datos)

  Se instala todo dentro de la carpeta del sistema (por ejemplo C:\ftth):
    runtime\  PostgreSQL + PostGIS, Node.js, PostgREST y el envoltorio de servicio
    basedatos\ archivos de PostgreSQL (solo administradores y el servicio)
    datos\    fotos, certificados, configuración y registros
    respaldos\
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Accion = 'ayuda',
  [Parameter(Position = 1)][string]$Argumento,
  [switch]$Demo,
  [string]$Destino,
  [switch]$Pausa
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ----------------------------------------------------------------------------
# Rutas, puertos y versiones
# ----------------------------------------------------------------------------
$Win = $PSScriptRoot
$Raiz = Split-Path -Parent $Win
$Runtime = Join-Path $Raiz 'runtime'
$Descargas = Join-Path $Runtime 'descargas'
$Datos = Join-Path $Raiz 'datos'
$Respaldos = Join-Path $Raiz 'respaldos'
$PgDir = Join-Path $Runtime 'pgsql'
$PgBin = Join-Path $PgDir 'bin'
$PgData = Join-Path $Raiz 'basedatos'
$NodeDir = Join-Path $Runtime 'node'
$NodeExe = Join-Path $NodeDir 'node.exe'
$PostgrestExe = Join-Path $Runtime 'postgrest\postgrest.exe'
$ServicioDir = Join-Path $Runtime 'servicio'
$ServicioExe = Join-Path $ServicioDir 'PlataformaFTTH.exe'
$Secretos = Join-Path $Datos 'secretos.json'
$ConfigJson = Join-Path $Datos 'config.json'
$PostgrestConf = Join-Path $Datos 'postgrest.conf'
$Frontend = Join-Path $Raiz 'frontend'
$Servidor = Join-Path $Raiz 'servidor'
$Icono = Join-Path $Win 'ftth.ico'
$Marcas = Join-Path $Runtime 'versiones.json'

$PuertoPg = 54330
$PuertoPostgrest = 54331
$ServicioBase = 'PlataformaFTTH-BaseDatos'
$ServicioApp = 'PlataformaFTTH'
$TareaRespaldo = 'Plataforma FTTH - Respaldo diario'
$ReglaFirewall = 'Plataforma FTTH (HTTP/HTTPS)'

$Versiones = @{
  PostgreSQL = '17.11'
  PostGIS    = 'pg17'
  PostgREST  = 'v16.5'
  WinSW      = 'v2.12.0'
  Node       = 'v24'
}
$Fuentes = @{
  PostgreSQL = @(
    "https://get.enterprisedb.com/postgresql/postgresql-$($Versiones.PostgreSQL)-1-windows-x64-binaries.zip",
    'https://sbp.enterprisedb.com/getfile.jsp?fileid=1260616'
  )
  PostGIS    = 'https://download.osgeo.org/postgis/windows/pg17/'
  PostgREST  = @{
    Url    = "https://github.com/PostgREST/postgrest/releases/download/$($Versiones.PostgREST)/postgrest-$($Versiones.PostgREST)-windows-x86-64.zip"
    Sha256 = '17f595b0d8dd37473d0231417dea07c5ac9f791282ff5b017fae51ff29e5de2f'
  }
  WinSW      = @{
    Url    = "https://github.com/winsw/winsw/releases/download/$($Versiones.WinSW)/WinSW.NET4.exe"
    Sha256 = '923111c7142b3dc783a3c722b19b8a21bcb78222d7a136ac33f0ca8a29f4cb66'
  }
  Node       = 'https://nodejs.org/dist/'
  VcRedist   = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
}

# Acciones que necesitan permisos de administrador (se piden solas).
$RequiereAdmin = @('instalar', 'crear-usuario', 'borrar-demo', 'respaldar', 'restaurar', 'programar-respaldo', 'actualizar',
  'correo', 'reiniciar', 'detener', 'iniciar', 'desinstalar', 'logs')

# ----------------------------------------------------------------------------
# Mensajes
# ----------------------------------------------------------------------------
function Paso([string]$t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }
function Ok([string]$t) { Write-Host "    OK  $t" -ForegroundColor Green }
function Aviso([string]$t) { Write-Host "    !   $t" -ForegroundColor Yellow }
function Info([string]$t) { Write-Host "        $t" }
function Falla([string]$t) { throw $t }

function Preguntar-SiNo([string]$texto, [bool]$porDefecto = $true) {
  $op = if ($porDefecto) { 'S/n' } else { 's/N' }
  $r = Read-Host "$texto [$op]"
  if ([string]::IsNullOrWhiteSpace($r)) { return $porDefecto }
  return $r.Trim().ToLower().StartsWith('s')
}

function Es-Administrador {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ----------------------------------------------------------------------------
# Programas externos
# ----------------------------------------------------------------------------
# Ejecuta y captura la salida sin que PowerShell 5.1 convierta stderr en errores.
function Invoke-Nativo([string]$Exe, [string[]]$Argumentos) {
  $previo = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $salida = & $Exe @Argumentos 2>&1 | ForEach-Object { "$_" }
    $codigo = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previo }
  [pscustomobject]@{ Codigo = $codigo; Salida = ($salida -join "`n") }
}

# Ejecuta mostrando la salida en vivo; devuelve el código de salida.
function Invoke-EnVivo([string]$Exe, [string[]]$Argumentos) {
  $previo = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Exe @Argumentos 2>&1 | ForEach-Object { Write-Host "        $_" }; $codigo = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previo }
  return $codigo
}

function Escribir-Texto([string]$Ruta, [string]$Texto) {
  [IO.File]::WriteAllText($Ruta, $Texto, (New-Object System.Text.UTF8Encoding($false)))
}

function Hex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return -join ($b | ForEach-Object { $_.ToString('x2') })
}

# ----------------------------------------------------------------------------
# Descargas
# ----------------------------------------------------------------------------
function Descargar([string]$Url, [string]$Archivo) {
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  if (Test-Path $curl) {
    $r = Invoke-Nativo $curl @('-fL', '--retry', '3', '--connect-timeout', '30', '-o', $Archivo, $Url)
    if ($r.Codigo -ne 0) { Falla "No se pudo descargar $Url ($($r.Salida))" }
  } else {
    Invoke-WebRequest -Uri $Url -OutFile $Archivo -UseBasicParsing
  }
}

function Comprobar-Hash([string]$Archivo, [string]$Esperado) {
  $real = (Get-FileHash -Algorithm SHA256 -Path $Archivo).Hash.ToLower()
  if ($real -ne $Esperado.ToLower()) {
    Remove-Item $Archivo -Force -ErrorAction SilentlyContinue
    Falla "La descarga $([IO.Path]::GetFileName($Archivo)) no coincide con la huella esperada (posible archivo dañado). Vuelva a intentar."
  }
}

# Usa la copia de runtime\descargas si existe y su huella coincide.
function Obtener([string]$Nombre, [string]$Url, [string]$Sha256) {
  New-Item -ItemType Directory -Force -Path $Descargas | Out-Null
  $archivo = Join-Path $Descargas $Nombre
  if ((Test-Path $archivo) -and $Sha256) {
    if ((Get-FileHash -Algorithm SHA256 -Path $archivo).Hash.ToLower() -eq $Sha256.ToLower()) { return $archivo }
    Remove-Item $archivo -Force
  }
  if (-not (Test-Path $archivo)) {
    Info "Descargando $Nombre..."
    Descargar $Url $archivo
  }
  if ($Sha256) { Comprobar-Hash $archivo $Sha256 }
  return $archivo
}

function Extraer([string]$Zip, [string]$Carpeta) {
  if (Test-Path $Carpeta) { Remove-Item $Carpeta -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path $tar) {
    $r = Invoke-Nativo $tar @('-xf', $Zip, '-C', $Carpeta)
    if ($r.Codigo -eq 0) { return }
  }
  Expand-Archive -Path $Zip -DestinationPath $Carpeta -Force
}

function Leer-Marcas {
  if (Test-Path $Marcas) { return (Get-Content -Raw -Path $Marcas | ConvertFrom-Json) }
  return [pscustomobject]@{}
}

function Guardar-Marca([string]$Clave, [string]$Valor) {
  $m = Leer-Marcas
  $m | Add-Member -NotePropertyName $Clave -NotePropertyValue $Valor -Force
  Escribir-Texto $Marcas ($m | ConvertTo-Json)
}

# ----------------------------------------------------------------------------
# Componentes
# ----------------------------------------------------------------------------
function Instalar-VcRedist {
  $dlls = 'vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll' | ForEach-Object { Join-Path $env:SystemRoot "System32\$_" }
  if (($dlls | Where-Object { -not (Test-Path $_) }).Count -eq 0) { return }
  Info 'Instalando Microsoft Visual C++ Redistributable (lo necesita PostgreSQL)...'
  $exe = Join-Path $Descargas 'vc_redist.x64.exe'
  New-Item -ItemType Directory -Force -Path $Descargas | Out-Null
  Descargar $Fuentes.VcRedist $exe
  $p = Start-Process -FilePath $exe -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru
  if (@(0, 1638, 3010) -notcontains $p.ExitCode) { Falla "El instalador de Visual C++ terminó con código $($p.ExitCode)" }
}

function Instalar-PostgreSQL {
  $m = Leer-Marcas
  # 'Instalacion' = 2: PostGIS copiado sin pisar bibliotecas de PostgreSQL.
  # Las instalaciones anteriores se reparan extrayendo de nuevo PostgreSQL.
  if ((Test-Path (Join-Path $PgBin 'postgres.exe')) -and $m.PostgreSQL -eq $Versiones.PostgreSQL -and $m.Instalacion -eq '2') {
    Ok "PostgreSQL $($Versiones.PostgreSQL) ya instalado"
    return
  }
  foreach ($n in $ServicioApp, $ServicioBase) {
    $sv = Get-Service -Name $n -ErrorAction SilentlyContinue
    if ($sv -and $sv.Status -ne 'Stopped') { Stop-Service $n -Force; Start-Sleep -Seconds 2 }
  }
  Instalar-VcRedist
  $zip = Join-Path $Descargas "postgresql-$($Versiones.PostgreSQL)-windows-x64-binaries.zip"
  if (-not (Test-Path $zip)) {
    $hecho = $false
    foreach ($url in $Fuentes.PostgreSQL) {
      try { Info "Descargando PostgreSQL $($Versiones.PostgreSQL) (unos 300 MB)..."; Descargar $url $zip; $hecho = $true; break }
      catch { Aviso $_.Exception.Message; Remove-Item $zip -Force -ErrorAction SilentlyContinue }
    }
    if (-not $hecho) { Falla 'No se pudo descargar PostgreSQL. Revise la conexión a internet.' }
  }
  $tmp = Join-Path $Runtime 'tmp-pgsql'
  Extraer $zip $tmp
  $origen = Join-Path $tmp 'pgsql'
  if (-not (Test-Path (Join-Path $origen 'bin\postgres.exe'))) {
    Remove-Item $zip -Force
    Falla 'El archivo de PostgreSQL descargado no es válido. Vuelva a ejecutar la instalación.'
  }
  if (Test-Path $PgDir) { Remove-Item $PgDir -Recurse -Force }
  Move-Item $origen $PgDir
  Remove-Item $tmp -Recurse -Force
  Guardar-Marca 'PostgreSQL' $Versiones.PostgreSQL
  Guardar-Marca 'PostGIS' ''
  $v = Invoke-Nativo (Join-Path $PgBin 'postgres.exe') @('--version')
  if ($v.Codigo -ne 0) { Falla "PostgreSQL no arranca en este equipo: $($v.Salida)" }
  Ok $v.Salida
}

function Instalar-PostGIS {
  if (Test-Path (Join-Path $PgDir 'share\extension\postgis.control')) { Ok 'PostGIS ya instalado'; return }
  Info 'Buscando la última versión de PostGIS para PostgreSQL 17...'
  $listado = Join-Path $Descargas 'postgis-listado.html'
  Descargar $Fuentes.PostGIS $listado
  $html = Get-Content -Raw -Path $listado
  $nombres = [regex]::Matches($html, 'href="(postgis-bundle-pg17[^"/]*x64[^"/]*\.zip)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  if (-not $nombres) { Falla "No se encontró el paquete de PostGIS en $($Fuentes.PostGIS). Avise para actualizar el instalador." }
  # El de versión más alta.
  $elegido = $nombres | Sort-Object { [version](([regex]::Match($_, '(\d+\.\d+\.\d+)')).Groups[1].Value) } | Select-Object -Last 1
  $zip = Join-Path $Descargas $elegido
  if (-not (Test-Path $zip)) { Info "Descargando $elegido..."; Descargar ($Fuentes.PostGIS + $elegido) $zip }
  $tmp = Join-Path $Runtime 'tmp-postgis'
  Extraer $zip $tmp
  # El zip trae una carpeta con bin, lib, share (y otras): se agregan a pgsql
  # SIN reemplazar nada. El paquete trae sus propias copias de bibliotecas
  # (OpenSSL, libxml2...) que, si pisan las de PostgreSQL, rompen pgcrypto.
  $base = Get-ChildItem -Path $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'share') } | Select-Object -First 1
  if (-not $base) { $base = Get-Item $tmp }
  $nuevos = 0
  foreach ($sub in 'bin', 'lib', 'share') {
    $o = Join-Path $base.FullName $sub
    if (-not (Test-Path $o)) { continue }
    foreach ($f in Get-ChildItem -Path $o -Recurse -File) {
      $destino = Join-Path (Join-Path $PgDir $sub) $f.FullName.Substring($o.Length).TrimStart([char]92)
      if (Test-Path $destino) { continue }
      New-Item -ItemType Directory -Force -Path (Split-Path $destino) | Out-Null
      Copy-Item -Path $f.FullName -Destination $destino
      $nuevos++
    }
  }
  Info "$nuevos archivos de PostGIS agregados"
  Remove-Item $tmp -Recurse -Force
  if (-not (Test-Path (Join-Path $PgDir 'share\extension\postgis.control'))) { Falla 'PostGIS no quedó instalado correctamente.' }
  Guardar-Marca 'PostGIS' $elegido
  Guardar-Marca 'Instalacion' '2'
  Ok "PostGIS instalado ($elegido)"
}

function Instalar-Node {
  $m = Leer-Marcas
  if ((Test-Path $NodeExe) -and $m.Node) { Ok "Node.js $($m.Node) ya instalado"; return }
  Info 'Buscando la última versión LTS de Node.js 24...'
  $indice = Invoke-RestMethod -Uri ($Fuentes.Node + 'index.json') -UseBasicParsing
  $rel = $indice | Where-Object { $_.version -like "$($Versiones.Node).*" -and $_.lts -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
  if (-not $rel) { Falla 'No se encontró Node.js 24 para Windows.' }
  $v = $rel.version
  $nombre = "node-$v-win-x64.zip"
  $sumas = (Invoke-WebRequest -Uri ($Fuentes.Node + "$v/SHASUMS256.txt") -UseBasicParsing).Content
  $linea = ($sumas -split "`n") | Where-Object { $_ -match "\s$([regex]::Escape($nombre))\s*$" } | Select-Object -First 1
  if (-not $linea) { Falla "No se encontró la huella de $nombre" }
  $zip = Obtener $nombre ($Fuentes.Node + "$v/$nombre") (($linea -split '\s+')[0])
  $tmp = Join-Path $Runtime 'tmp-node'
  Extraer $zip $tmp
  if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
  Move-Item (Join-Path $tmp "node-$v-win-x64") $NodeDir
  Remove-Item $tmp -Recurse -Force
  Guardar-Marca 'Node' $v
  Ok "Node.js $v"
}

function Instalar-PostgREST {
  $m = Leer-Marcas
  if ((Test-Path $PostgrestExe) -and $m.PostgREST -eq $Versiones.PostgREST) { Ok "PostgREST $($Versiones.PostgREST) ya instalado"; return }
  $zip = Obtener "postgrest-$($Versiones.PostgREST)-windows-x86-64.zip" $Fuentes.PostgREST.Url $Fuentes.PostgREST.Sha256
  $tmp = Join-Path $Runtime 'tmp-postgrest'
  Extraer $zip $tmp
  New-Item -ItemType Directory -Force -Path (Split-Path $PostgrestExe) | Out-Null
  Copy-Item (Join-Path $tmp 'postgrest.exe') $PostgrestExe -Force
  Remove-Item $tmp -Recurse -Force
  Guardar-Marca 'PostgREST' $Versiones.PostgREST
  Ok "PostgREST $($Versiones.PostgREST)"
}

function Instalar-WinSW {
  $m = Leer-Marcas
  if ((Test-Path $ServicioExe) -and $m.WinSW -eq $Versiones.WinSW) { return }
  $exe = Obtener "WinSW-$($Versiones.WinSW).NET4.exe" $Fuentes.WinSW.Url $Fuentes.WinSW.Sha256
  New-Item -ItemType Directory -Force -Path $ServicioDir | Out-Null
  Copy-Item $exe $ServicioExe -Force
  Guardar-Marca 'WinSW' $Versiones.WinSW
}

# ----------------------------------------------------------------------------
# Secretos, permisos y configuración
# ----------------------------------------------------------------------------
function Proteger-Carpeta([string]$Carpeta) {
  # Solo Administradores (S-1-5-32-544), SYSTEM (S-1-5-18) y la cuenta que instala.
  # La cuenta va explícita porque initdb y pg_ctl, al correr como administrador,
  # renuncian a ese grupo (token restringido) y sin ella no podrían usar la carpeta.
  New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
  $yo = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $permisos = @('*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F')
  if ($yo -ne 'S-1-5-18') { $permisos += "*${yo}:(OI)(CI)F" }
  $r = Invoke-Nativo 'icacls.exe' (@($Carpeta, '/inheritance:r', '/grant:r') + $permisos + @('/Q'))
  if ($r.Codigo -ne 0) { Aviso "No se pudieron fijar permisos en ${Carpeta}: $($r.Salida)" }
}

function Leer-Secretos {
  if (-not (Test-Path $Secretos)) { Falla 'Falta la configuración. Ejecute INSTALAR.cmd.' }
  return Get-Content -Raw -Path $Secretos | ConvertFrom-Json
}

function Asegurar-Secretos {
  Proteger-Carpeta $Datos
  if (Test-Path $Secretos) { return }
  $s = [ordered]@{ postgres = (Hex 24); authenticator = (Hex 24); jwt_secret = (Hex 32) }
  Escribir-Texto $Secretos ($s | ConvertTo-Json)
  Ok 'Claves generadas (datos\secretos.json, solo administradores)'
}

function Escribir-Config {
  $s = Leer-Secretos
  $smtp = $null
  if (Test-Path $ConfigJson) {
    try { $smtp = (Get-Content -Raw -Path $ConfigJson | ConvertFrom-Json).smtp } catch { }
  }
  $cfg = [ordered]@{
    jwt_secret   = $s.jwt_secret
    postgrest    = [ordered]@{ exe = $PostgrestExe; config = $PostgrestConf; url = "http://127.0.0.1:$PuertoPostgrest"; path = $PgBin }
    web          = (Join-Path $Frontend 'dist')
    archivos     = (Join-Path $Datos 'archivos')
    certificados = (Join-Path $Datos 'certificados')
    puertos      = [ordered]@{ http = 80; https = 443 }
    smtp         = $smtp
  }
  Escribir-Texto $ConfigJson ($cfg | ConvertTo-Json -Depth 5)
  Escribir-Texto $PostgrestConf (@(
      "db-uri = `"postgres://authenticator:$($s.authenticator)@127.0.0.1:$PuertoPg/ftth`""
      'db-schemas = "public,storage,servidor"'
      'db-anon-role = "anon"'
      'db-extra-search-path = "public,extensions"'
      "jwt-secret = `"$($s.jwt_secret)`""
      'server-host = "127.0.0.1"'
      "server-port = $PuertoPostgrest"
      'db-max-rows = 1000'
      'db-pool = 10'
      'log-level = "error"'
    ) -join "`n")
}

# ----------------------------------------------------------------------------
# PostgreSQL
# ----------------------------------------------------------------------------
function Entorno-Pg {
  $env:PGPASSWORD = (Leer-Secretos).postgres
  $env:PGCLIENTENCODING = 'UTF8'
  # Mensajes de las herramientas de PostgreSQL en inglés: en español salen en
  # otra codificación de Windows y se ven con caracteres rotos.
  $env:LC_MESSAGES = 'C'
}

function Psql([string[]]$Extra, [string]$Base = 'ftth') {
  Entorno-Pg
  Invoke-Nativo (Join-Path $PgBin 'psql.exe') (@('-h', 'localhost', '-p', "$PuertoPg", '-U', 'postgres', '-d', $Base,
      '-X', '-q', '-v', 'ON_ERROR_STOP=1') + $Extra)
}

function Esperar-Pg {
  for ($i = 0; $i -lt 60; $i++) {
    $r = Invoke-Nativo (Join-Path $PgBin 'pg_isready.exe') @('-h', 'localhost', '-p', "$PuertoPg")
    if ($r.Codigo -eq 0) { return }
    Start-Sleep -Seconds 1
  }
  Falla 'La base de datos no responde. Revise datos\postgres\log.'
}

function Inicializar-Postgres {
  # Restos de un intento anterior (versiones previas usaban datos\postgres).
  $viejo = Join-Path $Datos 'postgres'
  if ((Test-Path $viejo) -and -not (Test-Path (Join-Path $viejo 'PG_VERSION'))) { Remove-Item $viejo -Recurse -Force }

  if (Test-Path (Join-Path $PgData 'PG_VERSION')) {
    Ok 'La base de datos ya existe: se conservan los datos'
  } else {
    if (Test-Path $PgData) { Remove-Item $PgData -Recurse -Force }
    Info 'Creando el almacén de datos...'
    Entorno-Pg
    # initdb corre con privilegios reducidos (sin el grupo Administradores):
    # la clave va en la carpeta temporal del usuario y el almacén se crea con
    # los permisos normales de la carpeta del sistema; después se restringe.
    $clave = Join-Path $env:TEMP "ftth-pg-$(Hex 4).tmp"
    Escribir-Texto $clave (Leer-Secretos).postgres
    $base = @('-D', $PgData, '-U', 'postgres', "--pwfile=$clave", '-E', 'UTF8', '-A', 'scram-sha-256')
    try {
      $r = Invoke-Nativo (Join-Path $PgBin 'initdb.exe') ($base + @('--locale-provider=icu', '--icu-locale=es-CL', '--locale=C'))
      if ($r.Codigo -ne 0) {
        $primero = $r.Salida
        if (Test-Path $PgData) { Remove-Item $PgData -Recurse -Force }
        $r = Invoke-Nativo (Join-Path $PgBin 'initdb.exe') ($base + @('--locale=C'))
        if ($r.Codigo -ne 0) { $r.Salida = "$primero`n---`n$($r.Salida)" }
      }
    } finally { Remove-Item $clave -Force -ErrorAction SilentlyContinue }
    if ($r.Codigo -ne 0) {
      if (Test-Path $PgData) { Remove-Item $PgData -Recurse -Force }
      Falla "initdb falló:`n$($r.Salida)"
    }
    Add-Content -Path (Join-Path $PgData 'postgresql.conf') -Encoding ASCII -Value @"

# --- Plataforma FTTH ---
port = $PuertoPg
listen_addresses = 'localhost'
max_connections = 60
shared_buffers = 256MB
timezone = 'America/Santiago'
log_timezone = 'America/Santiago'
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%a.log'
log_truncate_on_rotation = on
log_rotation_age = 1d
"@
    Ok 'Almacén de datos creado'
  }
  # Solo Administradores, SYSTEM, NETWORK SERVICE (S-1-5-20, la cuenta del
  # servicio) y quien instala. Los archivos de adentro heredan estos permisos.
  $yo = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $r = Invoke-Nativo 'icacls.exe' @($PgData, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F',
    '*S-1-5-20:(OI)(CI)F', "*${yo}:(OI)(CI)F", '/Q')
  if ($r.Codigo -ne 0) { Falla "No se pudieron fijar los permisos de la base de datos:`n$($r.Salida)" }

  # El servicio necesita leer y ejecutar los programas de PostgreSQL (si la carpeta
  # se movió desde Descargas, conserva permisos que solo incluyen al usuario).
  $r = Invoke-Nativo 'icacls.exe' @($PgDir, '/grant', '*S-1-5-20:(OI)(CI)RX', '/Q')
  if ($r.Codigo -ne 0) { Aviso "No se pudieron fijar permisos en ${PgDir}: $($r.Salida)" }

  if (-not (Get-Service -Name $ServicioBase -ErrorAction SilentlyContinue)) {
    $r = Invoke-Nativo (Join-Path $PgBin 'pg_ctl.exe') @('register', '-N', $ServicioBase, '-U', 'NT AUTHORITY\NetworkService',
      '-D', $PgData, '-S', 'auto', '-w')
    if ($r.Codigo -ne 0) { Falla "No se pudo registrar el servicio de base de datos:`n$($r.Salida)" }
    Invoke-Nativo 'sc.exe' @('description', $ServicioBase, 'Base de datos PostgreSQL de la Plataforma FTTH') | Out-Null
  }
  if ((Get-Service $ServicioBase).Status -ne 'Running') { Start-Service $ServicioBase }
  Esperar-Pg
  Ok "Servicio '$ServicioBase' en marcha (solo accesible desde este PC)"
}

function Preparar-Base {
  Paso 'Base de datos'
  $r = Psql @('-tA', '-c', "select 1 from pg_database where datname = 'ftth'") 'postgres'
  if ($r.Salida.Trim() -ne '1') {
    $r = Psql @('-c', 'create database ftth') 'postgres'
    if ($r.Codigo -ne 0) { Falla "No se pudo crear la base:`n$($r.Salida)" }
  }
  # Sin comillas dobles: PowerShell 5.1 las rompe al pasarlas a programas externos.
  $r = Psql @('-c', 'alter database ftth set search_path = public, extensions')
  if ($r.Codigo -ne 0) { Falla "No se pudo configurar la base:`n$($r.Salida)" }

  $r = Psql @('-f', (Join-Path $Servidor 'sql\00_entorno.sql'))
  if ($r.Codigo -ne 0) { Falla "Falló la preparación del entorno:`n$($r.Salida)" }
  $r = Psql @('-c', "alter role authenticator with login password '$((Leer-Secretos).authenticator)'")
  if ($r.Codigo -ne 0) { Falla "No se pudo fijar la clave de la API:`n$($r.Salida)" }

  $r = Psql @('-tA', '-c', 'select version from supabase_migrations.schema_migrations')
  $aplicadas = @($r.Salida -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $pendientes = Get-ChildItem -Path (Join-Path $Raiz 'supabase\migrations') -Filter '*.sql' | Sort-Object Name |
    Where-Object { $aplicadas -notcontains ($_.BaseName -split '_', 2)[0] }
  foreach ($m in $pendientes) {
    $version, $nombre = $m.BaseName -split '_', 2
    $registro = "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$nombre') on conflict do nothing"
    $r = Psql @('-1', '-f', $m.FullName, '-c', $registro)
    if ($r.Codigo -ne 0) { Falla "Falló la migración $($m.Name) (no se aplicó nada de ella):`n$($r.Salida)" }
    Ok $m.Name
  }
  if (-not $pendientes) { Ok 'Esquema al día' }

  $r = Psql @('-f', (Join-Path $Servidor 'sql\01_servidor.sql'))
  if ($r.Codigo -ne 0) { Falla "Falló la instalación de funciones del servidor:`n$($r.Salida)" }
  Psql @('-c', "notify pgrst, 'reload schema'") | Out-Null
}

function Cargar-Demo {
  $r = Psql @('-tA', '-c', 'select count(*) from public.clientes where es_demo')
  if ($r.Codigo -eq 0 -and [int]($r.Salida.Trim()) -gt 0) { Ok 'Los datos de demostración ya estaban cargados'; return }
  $r = Psql @('-1', '-f', (Join-Path $Raiz 'supabase\seed.sql'))
  if ($r.Codigo -ne 0) { Falla "No se pudieron cargar los datos de demostración:`n$($r.Salida)" }
  Ok "Datos de demostración cargados (se borran con 'Borrar datos de demostración' del menú Inicio)"
}

function Borrar-Demo {
  Paso 'Borrar datos de demostración'
  Info 'Se borra solo lo marcado como demostración (nombres que empiezan con DEMO). Sus datos reales no se tocan.'
  if (-not (Preguntar-SiNo '¿Continuar?' $false)) { return }
  $r = Psql @('-c', 'select public.eliminar_datos_demo()')
  if ($r.Codigo -ne 0) { Falla "No se pudieron borrar:`n$($r.Salida)" }
  Remove-Item (Join-Path (Carpeta-Menu) 'Borrar datos de demostración.lnk') -Force -ErrorAction SilentlyContinue
  Ok 'Datos de demostración borrados'
}

# ----------------------------------------------------------------------------
# Aplicación web y servicio
# ----------------------------------------------------------------------------
function Construir-Frontend {
  Paso 'Compilando la aplicación web (la primera vez descarga dependencias, unos minutos)'
  $env:PATH = "$NodeDir;$env:PATH"
  $npm = Join-Path $NodeDir 'npm.cmd'
  Push-Location $Frontend
  try {
    if ((Invoke-EnVivo $npm @('install', '--no-audit', '--no-fund', '--loglevel=error')) -ne 0) {
      Falla 'npm install falló. Revise la conexión a internet y copie el texto de arriba si persiste.'
    }
    if ((Invoke-EnVivo $NodeExe @('node_modules\vite\bin\vite.js', 'build', '--logLevel', 'warn')) -ne 0) {
      Falla 'La compilación de la aplicación falló. Copie el texto de arriba y envíelo para revisarlo.'
    }
  } finally { Pop-Location }
  if (-not (Test-Path (Join-Path $Frontend 'dist\index.html'))) { Falla 'La compilación no generó la aplicación.' }
  Ok 'Aplicación web compilada'
}

function Instalar-ServicioApp {
  $logs = Join-Path $Datos 'logs'
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $xml = @"
<service>
  <id>$ServicioApp</id>
  <name>Plataforma FTTH</name>
  <description>Servidor de la Plataforma FTTH: aplicación web (HTTPS), API y fotos.</description>
  <executable>$NodeExe</executable>
  <arguments>"$(Join-Path $Servidor 'servidor.mjs')" "$ConfigJson"</arguments>
  <workingdirectory>$Servidor</workingdirectory>
  <depend>$ServicioBase</depend>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>15 sec</stoptimeout>
  <logpath>$logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
</service>
"@
  Escribir-Texto (Join-Path $ServicioDir 'PlataformaFTTH.xml') $xml
  if (Get-Service -Name $ServicioApp -ErrorAction SilentlyContinue) {
    Stop-Service $ServicioApp -Force -ErrorAction SilentlyContinue
    Invoke-Nativo $ServicioExe @('uninstall') | Out-Null
    Start-Sleep -Seconds 2
  }
  $r = Invoke-Nativo $ServicioExe @('install')
  if ($r.Codigo -ne 0) { Falla "No se pudo registrar el servicio de la plataforma:`n$($r.Salida)" }
}

function Iniciar-App {
  if ((Get-Service $ServicioBase).Status -ne 'Running') { Start-Service $ServicioBase; Esperar-Pg }
  $s = Get-Service $ServicioApp
  if ($s.Status -eq 'Running') { Restart-Service $ServicioApp -Force } else { Start-Service $ServicioApp }
}

function Esperar-App {
  $ultimo = ''
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $r = Invoke-WebRequest -Uri 'https://localhost/salud' -UseBasicParsing -TimeoutSec 5
      if ($r.Content -eq 'ok') { return $true }
      $ultimo = "respondió '$($r.Content)' (la API de datos, PostgREST, no está en marcha)"
    } catch { $ultimo = $_.Exception.Message }
    Start-Sleep -Seconds 2
  }
  Aviso "Última respuesta de https://localhost/salud: $ultimo"
  $s = Get-Service -Name $ServicioApp -ErrorAction SilentlyContinue
  if ($s) { Aviso "Servicio ${ServicioApp}: $($s.Status)" }
  return $false
}

function Mostrar-Registros([int]$Lineas = 40) {
  $logs = Join-Path $Datos 'logs'
  foreach ($f in Get-ChildItem -Path $logs -Filter 'PlataformaFTTH*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 2) {
    Write-Host ''
    Write-Host "--- $($f.Name)" -ForegroundColor DarkGray
    Get-Content -Path $f.FullName -Tail $Lineas | ForEach-Object { Write-Host "    $_" }
  }
  $pglog = Get-ChildItem -Path (Join-Path $PgData 'log') -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($pglog) {
    Write-Host ''
    Write-Host "--- base de datos: $($pglog.Name)" -ForegroundColor DarkGray
    Get-Content -Path $pglog.FullName -Tail $Lineas | ForEach-Object { Write-Host "    $_" }
  }
}

function Configurar-Firewall {
  if (-not (Get-NetFirewallRule -DisplayName $ReglaFirewall -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ReglaFirewall -Direction Inbound -Protocol TCP -LocalPort 80, 443 `
      -Action Allow -Profile Private, Domain | Out-Null
  }
  Ok 'Puertos 80 y 443 abiertos para la red privada'
  foreach ($red in Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' }) {
    Aviso "La red '$($red.Name)' está marcada como Pública: los demás equipos no podrán entrar."
    if (Preguntar-SiNo "¿Marcar '$($red.Name)' como red Privada?") {
      Set-NetConnectionProfile -InterfaceIndex $red.InterfaceIndex -NetworkCategory Private
      Ok "Red '$($red.Name)' marcada como Privada"
    }
  }
}

function Instalar-Certificado {
  $raiz = Join-Path $Datos 'certificados\raiz.crt'
  for ($i = 0; $i -lt 30 -and -not (Test-Path $raiz); $i++) { Start-Sleep -Seconds 1 }
  if (-not (Test-Path $raiz)) { Aviso 'El certificado aún no existe. Revise el servicio con "Estado".'; return }
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($raiz)
  if (-not (Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })) {
    Import-Certificate -FilePath $raiz -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
  }
  Ok 'Certificado de la oficina instalado en este PC'
}

function Comprobar-Puertos {
  foreach ($puerto in 80, 443) {
    foreach ($c in Get-NetTCPConnection -State Listen -LocalPort $puerto -ErrorAction SilentlyContinue) {
      $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      $nombre = if ($proc) { $proc.ProcessName } else { "PID $($c.OwningProcess)" }
      if ($nombre -eq 'node') { continue }  # la propia plataforma
      $extra = if ($c.OwningProcess -eq 4) { ' (servicio de Windows que usa HTTP.sys: IIS, "World Wide Web Publishing" u otro)' } else { '' }
      Falla "El puerto $puerto está ocupado por $nombre$extra. Deténgalo o desinstálelo y vuelva a ejecutar."
    }
  }
}

# ----------------------------------------------------------------------------
# Accesos directos
# ----------------------------------------------------------------------------
function Carpeta-Menu { Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Plataforma FTTH' }

function Nuevo-AccesoWeb([string]$Ruta, [string]$Url) {
  Escribir-Texto $Ruta "[InternetShortcut]`r`nURL=$Url`r`nIconFile=$Icono`r`nIconIndex=0`r`n"
}

function Nuevo-Acceso([string]$Ruta, [string]$Accion, [string]$Descripcion) {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $atajo = (New-Object -ComObject WScript.Shell).CreateShortcut($Ruta)
  $atajo.TargetPath = $ps
  $atajo.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" $Accion -Pausa"
  $atajo.WorkingDirectory = $Win
  $atajo.Description = $Descripcion
  if (Test-Path $Icono) { $atajo.IconLocation = "$Icono,0" }
  $atajo.Save()
}

function Crear-Accesos {
  $menu = Carpeta-Menu
  New-Item -ItemType Directory -Force -Path $menu | Out-Null
  Nuevo-AccesoWeb (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Plataforma FTTH.url') 'https://localhost/'
  Nuevo-AccesoWeb (Join-Path $menu 'Plataforma FTTH.url') 'https://localhost/'
  Nuevo-Acceso (Join-Path $menu 'Crear usuario.lnk') 'crear-usuario' 'Crea un usuario con contraseña y rol'
  Nuevo-Acceso (Join-Path $menu 'Estado.lnk') 'estado' 'Estado de la plataforma y direcciones para otros equipos'
  Nuevo-Acceso (Join-Path $menu 'Respaldar.lnk') 'respaldar' 'Respaldo de base de datos, fotos y configuración'
  Nuevo-Acceso (Join-Path $menu 'Reiniciar.lnk') 'reiniciar' 'Reinicia la plataforma'
  Nuevo-Acceso (Join-Path $menu 'Configurar correo.lnk') 'correo' 'Servidor de correo para invitaciones (opcional)'
  Nuevo-Acceso (Join-Path $menu 'Actualizar.lnk') 'actualizar' 'Aplica una versión nueva (respalda antes)'
  $demo = Psql @('-tA', '-c', 'select count(*) from public.clientes where es_demo')
  if ($demo.Codigo -eq 0 -and [int]($demo.Salida.Trim()) -gt 0) {
    Nuevo-Acceso (Join-Path $menu 'Borrar datos de demostración.lnk') 'borrar-demo' 'Borra solo los datos de ejemplo'
  }
  Ok "Ícono 'Plataforma FTTH' en el escritorio y carpeta 'Plataforma FTTH' en el menú Inicio"
}

# ----------------------------------------------------------------------------
# Usuarios
# ----------------------------------------------------------------------------
function Leer-Clave {
  for ($i = 0; $i -lt 3; $i++) {
    $a = Read-Host 'Contraseña (mínimo 8 caracteres)' -AsSecureString
    $b = Read-Host 'Repita la contraseña' -AsSecureString
    $pa = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($a))
    $pb = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($b))
    if ($pa -ne $pb) { Aviso 'Las contraseñas no coinciden.'; continue }
    if ($pa.Length -lt 8) { Aviso 'Debe tener al menos 8 caracteres.'; continue }
    return $pa
  }
  Falla 'No se ingresó una contraseña válida.'
}

# Texto SQL seguro con dollar-quoting y etiqueta aleatoria (sin pasar datos por la línea de comandos).
function Literal([string]$Texto) {
  $tag = 'f' + (Hex 6)
  return "`$$tag`$$Texto`$$tag`$"
}

function Crear-Usuario {
  $roles = @('administrador', 'supervisor_red', 'tecnico', 'atencion_cliente', 'inventario')
  Paso 'Crear usuario'
  $correo = Read-Host 'Correo'
  if ($correo -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Falla "Correo no válido: $correo" }
  $nombre = Read-Host 'Nombre y apellido'
  Info 'Roles: 1) administrador  2) supervisor_red  3) tecnico  4) atencion_cliente  5) inventario'
  $sel = Read-Host 'Rol [1]'
  if ([string]::IsNullOrWhiteSpace($sel)) { $sel = '1' }
  $idx = 0
  if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 1 -or $idx -gt 5) { Falla "Opción de rol no válida: $sel" }
  $clave = Leer-Clave
  $sql = Join-Path $Datos "usuario-$(Hex 4).sql"
  Escribir-Texto $sql "select servidor.crear_usuario($(Literal $correo), $(Literal $clave), $(Literal $nombre), '$($roles[$idx - 1])'::public.rol_app);"
  try { $r = Psql @('-f', $sql) } finally { Remove-Item $sql -Force -ErrorAction SilentlyContinue }
  if ($r.Codigo -ne 0) { Falla (($r.Salida -split "`n") | Where-Object { $_ -match 'ERROR' } | Select-Object -First 1) }
  Ok "Usuario creado: $correo ($($roles[$idx - 1])). Ya puede ingresar."
}

# ----------------------------------------------------------------------------
# Respaldos
# ----------------------------------------------------------------------------
function Respaldar {
  $carpeta = if ($Destino) { $Destino } else { $Respaldos }
  if (-not $Destino) { Proteger-Carpeta $Respaldos }
  New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
  $fecha = Get-Date -Format 'yyyy-MM-dd_HHmm'
  Paso "Respaldo en $carpeta"
  Entorno-Pg
  $dump = Join-Path $carpeta "ftth_base_$fecha.dump"
  $r = Invoke-Nativo (Join-Path $PgBin 'pg_dump.exe') @('-h', 'localhost', '-p', "$PuertoPg", '-U', 'postgres', '-Fc', '-f', $dump, 'ftth')
  if ($r.Codigo -ne 0) { Falla "Falló el respaldo de la base de datos:`n$($r.Salida)" }
  Ok "Base de datos: $dump ($([math]::Round((Get-Item $dump).Length / 1MB, 1)) MB)"
  $archivos = Join-Path $Datos 'archivos'
  if (Get-ChildItem -Path $archivos -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1) {
    $zip = Join-Path $carpeta "ftth_fotos_$fecha.zip"
    Compress-Archive -Path (Join-Path $archivos '*') -DestinationPath $zip -Force
    Ok "Fotos de órdenes: $zip"
  } else { Info 'Fotos de órdenes: aún no hay.' }
  Copy-Item $ConfigJson (Join-Path $carpeta "ftth_configuracion_$fecha.json")
  foreach ($patron in 'ftth_base_*.dump', 'ftth_fotos_*.zip', 'ftth_configuracion_*.json') {
    Get-ChildItem -Path $carpeta -Filter $patron | Sort-Object Name -Descending | Select-Object -Skip 14 | Remove-Item -Force
  }
  Aviso 'Copie periódicamente esta carpeta a otro equipo o disco externo.'
}

function Restaurar([string]$Archivo) {
  if (-not $Archivo -or -not (Test-Path $Archivo)) { Falla 'Indique el archivo .dump a restaurar: ftth.ps1 restaurar <archivo>' }
  $Archivo = (Resolve-Path $Archivo).Path
  Write-Host "Se REEMPLAZARÁN todos los datos actuales por los de $([IO.Path]::GetFileName($Archivo))." -ForegroundColor Yellow
  if ((Read-Host 'Escriba RESTAURAR para continuar') -cne 'RESTAURAR') { Info 'Cancelado.'; return }
  Paso 'Respaldo de seguridad del estado actual'
  $script:Destino = Join-Path $Respaldos 'antes-de-restaurar'
  try { Respaldar } catch { Aviso "No se pudo respaldar el estado actual: $($_.Exception.Message)" }
  $script:Destino = $null
  Paso 'Restaurando'
  Stop-Service $ServicioApp -Force -ErrorAction SilentlyContinue
  Psql @('-c', "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'ftth' and pid <> pg_backend_pid()") 'postgres' | Out-Null
  $r = Psql @('-c', 'drop database if exists ftth') 'postgres'
  if ($r.Codigo -ne 0) { Falla "No se pudo reemplazar la base:`n$($r.Salida)" }
  Psql @('-c', 'create database ftth') 'postgres' | Out-Null
  Entorno-Pg
  $r = Invoke-Nativo (Join-Path $PgBin 'pg_restore.exe') @('-h', 'localhost', '-p', "$PuertoPg", '-U', 'postgres', '-d', 'ftth', $Archivo)
  if ($r.Codigo -ne 0) { Aviso "pg_restore informó advertencias:`n$($r.Salida)" }
  Preparar-Base
  $fotos = $Archivo -replace 'ftth_base_', 'ftth_fotos_' -replace '\.dump$', '.zip'
  if ((Test-Path $fotos) -and (Preguntar-SiNo "¿Restaurar también las fotos ($([IO.Path]::GetFileName($fotos)))?")) {
    Expand-Archive -Path $fotos -DestinationPath (Join-Path $Datos 'archivos') -Force
    Ok 'Fotos restauradas'
  }
  Iniciar-App
  if (Esperar-App) { Ok 'Restauración terminada' } else { Aviso 'La plataforma no respondió. Revise con "Estado".' }
}

function Programar-Respaldo([string]$Hora) {
  if (-not $Hora) { $Hora = '13:00' }
  $h = [datetime]::ParseExact($Hora, 'HH:mm', $null)
  $accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" respaldar"
  $disparador = New-ScheduledTaskTrigger -Daily -At $h
  $ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $TareaRespaldo -Action $accion -Trigger $disparador -Settings $ajustes `
    -User 'NT AUTHORITY\SYSTEM' -RunLevel Highest -Description 'Respaldo de la Plataforma FTTH' -Force | Out-Null
  Ok "Respaldo diario a las $Hora en $Respaldos (corre aunque nadie haya iniciado sesión)"
}

# ----------------------------------------------------------------------------
# Correo
# ----------------------------------------------------------------------------
function Configurar-Correo {
  Paso 'Servidor de correo (SMTP)'
  Info 'Con correo, las invitaciones y la recuperación de contraseña llegan solas.'
  Info 'Sin correo, el administrador comparte los enlaces (por ejemplo por WhatsApp).'
  Info 'Gmail: servidor smtp.gmail.com, puerto 587 y una "contraseña de aplicación".'
  $cfg = Get-Content -Raw -Path $ConfigJson | ConvertFrom-Json
  $servidorSmtp = Read-Host 'Servidor (vacío para desactivar el correo)'
  if ([string]::IsNullOrWhiteSpace($servidorSmtp)) {
    $cfg.smtp = $null
  } else {
    $puerto = Read-Host 'Puerto [587]'
    if ([string]::IsNullOrWhiteSpace($puerto)) { $puerto = '587' }
    $usuario = Read-Host 'Usuario (normalmente el correo)'
    $s = Read-Host 'Contraseña' -AsSecureString
    $clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    $remitente = Read-Host "Remitente [$usuario]"
    if ([string]::IsNullOrWhiteSpace($remitente)) { $remitente = $usuario }
    $cfg.smtp = [ordered]@{
      host = $servidorSmtp.Trim(); puerto = [int]$puerto
      seguro = $(if ($puerto -eq '465') { 'tls' } else { 'starttls' })
      usuario = $usuario.Trim(); clave = $clave; remitente = $remitente.Trim(); nombre = 'Plataforma FTTH'
    }
  }
  Escribir-Texto $ConfigJson ($cfg | ConvertTo-Json -Depth 5)
  Ok 'Configuración guardada'
  if ($cfg.smtp) {
    $para = Read-Host 'Correo para enviar una prueba (vacío para omitir)'
    if ($para) {
      $r = Invoke-Nativo $NodeExe @((Join-Path $Servidor 'probar-correo.mjs'), $ConfigJson, $para)
      if ($r.Codigo -eq 0) { Ok $r.Salida } else { Aviso $r.Salida }
    }
  }
  Iniciar-App
  if (Esperar-App) { Ok 'Plataforma reiniciada con la nueva configuración' }
}

# ----------------------------------------------------------------------------
# Estado
# ----------------------------------------------------------------------------
function Direcciones-Lan {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress
}

function Mostrar-Estado {
  Paso 'Estado'
  foreach ($n in $ServicioBase, $ServicioApp) {
    $s = Get-Service -Name $n -ErrorAction SilentlyContinue
    if (-not $s) { Aviso "$n no está instalado" }
    elseif ($s.Status -eq 'Running') { Ok "$n en marcha" }
    else { Aviso "$n está $($s.Status)" }
  }
  try {
    $r = Invoke-WebRequest -Uri 'https://localhost/salud' -UseBasicParsing -TimeoutSec 5
    if ($r.Content -eq 'ok') { Ok 'La aplicación responde' } else { Aviso "La aplicación responde: $($r.Content)" }
  } catch { Aviso "La aplicación no responde: $($_.Exception.Message)" }
  Write-Host ''
  Write-Host '  Plataforma FTTH' -ForegroundColor Green
  Write-Host '    En este PC:                       https://localhost'
  foreach ($ip in Direcciones-Lan) {
    Write-Host "    Desde otros PCs y celulares:      https://$ip"
    Write-Host "    Certificado para esos equipos:    http://$ip/certificado.crt"
  }
  Write-Host ''
}

# ----------------------------------------------------------------------------
# Acciones principales
# ----------------------------------------------------------------------------
function Accion-Instalar {
  Write-Host 'Instalación de la Plataforma FTTH para Windows' -ForegroundColor Green
  if (-not [Environment]::Is64BitOperatingSystem) { Falla 'Se necesita Windows de 64 bits.' }
  if ($Raiz -like "$env:USERPROFILE*" -or $Raiz -match 'OneDrive') {
    Falla "La carpeta está dentro de su perfil de usuario ($Raiz). Los servicios de Windows no pueden usarla: mueva la carpeta a C:\ftth y vuelva a ejecutar INSTALAR.cmd."
  }
  if ($Raiz -match '\s') { Aviso "La carpeta '$Raiz' tiene espacios; se recomienda C:\ftth." }
  Get-ChildItem -Path $Raiz -Recurse -File -Include '*.ps1', '*.cmd', '*.mjs' -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
  Comprobar-Puertos

  Paso 'Componentes (se descargan una sola vez)'
  New-Item -ItemType Directory -Force -Path $Runtime, $Descargas | Out-Null
  Instalar-PostgreSQL
  Instalar-PostGIS
  Instalar-Node
  Instalar-PostgREST
  Instalar-WinSW

  Paso 'Configuración'
  Asegurar-Secretos
  Escribir-Config
  Ok 'datos\config.json y datos\postgrest.conf'

  Paso 'Servicio de base de datos'
  Inicializar-Postgres
  Preparar-Base
  # Sin datos de ejemplo: al ingresar, el asistente "Primeros pasos" guía la
  # creación de la red real. La demostración solo se carga con -Demo.
  if ($Demo) { Cargar-Demo }

  Construir-Frontend

  Paso 'Servicio de la plataforma'
  Instalar-ServicioApp
  Configurar-Firewall
  Iniciar-App
  Instalar-Certificado
  if (Esperar-App) { Ok 'La plataforma responde en https://localhost' }
  else { Mostrar-Registros; Falla 'La plataforma no respondió. Copie los registros de arriba y envíelos para revisarlos.' }

  $r = Psql @('-tA', '-c', "select count(*) from public.usuario_roles where rol = 'administrador'")
  if ($r.Codigo -eq 0 -and [int]($r.Salida.Trim()) -eq 0) {
    Write-Host ''
    Info 'Falta crear el primer administrador.'
    Crear-Usuario
  }

  Paso 'Accesos directos y respaldo'
  Crear-Accesos
  if (-not (Get-ScheduledTask -TaskName $TareaRespaldo -ErrorAction SilentlyContinue)) {
    if (Preguntar-SiNo '¿Programar un respaldo automático diario a las 13:00?') { Programar-Respaldo '13:00' }
  }
  Mostrar-Estado
  Info "Para entrar: doble clic en 'Plataforma FTTH' en el escritorio."
  Info 'La plataforma arranca sola con Windows; no hace falta iniciar sesión en el PC.'
  if (Preguntar-SiNo '¿Abrir la plataforma ahora en el navegador?') { Start-Process 'https://localhost/' }
}

function Accion-Actualizar {
  Write-Host 'Actualización de la Plataforma FTTH' -ForegroundColor Green
  if ((Test-Path (Join-Path $Raiz '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Paso 'Descargando la última versión desde GitHub'
    $g = Invoke-Nativo 'git' @('-C', $Raiz, 'pull', '--ff-only')
    if ($g.Codigo -ne 0) { Falla "git pull falló:`n$($g.Salida)" }
    Ok $g.Salida
  }
  Respaldar
  Paso 'Componentes'
  Stop-Service $ServicioApp -Force -ErrorAction SilentlyContinue
  $m = Leer-Marcas
  if ($m.PostgreSQL -ne $Versiones.PostgreSQL) {
    Stop-Service $ServicioBase -Force
    Instalar-PostgreSQL
    Instalar-PostGIS
    Start-Service $ServicioBase
    Esperar-Pg
  }
  Instalar-Node
  Instalar-PostgREST
  Instalar-WinSW
  Escribir-Config
  Preparar-Base
  Construir-Frontend
  Paso 'Reiniciando la plataforma'
  Instalar-ServicioApp
  Iniciar-App
  if (Esperar-App) { Ok 'Actualización terminada' } else { Mostrar-Registros; Falla 'La plataforma no respondió tras actualizar.' }
}

function Accion-Desinstalar {
  Write-Host 'Desinstalar la Plataforma FTTH' -ForegroundColor Yellow
  if (-not (Preguntar-SiNo '¿Quitar la plataforma de este PC?' $false)) { return }
  if (Get-Service -Name $ServicioApp -ErrorAction SilentlyContinue) {
    Stop-Service $ServicioApp -Force -ErrorAction SilentlyContinue
    Invoke-Nativo $ServicioExe @('uninstall') | Out-Null
  }
  if (Get-Service -Name $ServicioBase -ErrorAction SilentlyContinue) {
    Stop-Service $ServicioBase -Force -ErrorAction SilentlyContinue
    Invoke-Nativo (Join-Path $PgBin 'pg_ctl.exe') @('unregister', '-N', $ServicioBase) | Out-Null
  }
  Get-NetFirewallRule -DisplayName $ReglaFirewall -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  $raiz = Join-Path $Datos 'certificados\raiz.crt'
  if (Test-Path $raiz) {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($raiz)
    Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint } | Remove-Item
  }
  Unregister-ScheduledTask -TaskName $TareaRespaldo -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Plataforma FTTH.url') -Force -ErrorAction SilentlyContinue
  Remove-Item (Carpeta-Menu) -Recurse -Force -ErrorAction SilentlyContinue
  Ok 'Servicios, firewall, certificado, accesos y tarea de respaldo quitados'
  Write-Host ''
  Aviso "Los datos siguen en $Datos y los respaldos en $Respaldos."
  if ((Read-Host 'Para BORRAR datos, respaldos y componentes escriba BORRAR (Enter para conservarlos)') -ceq 'BORRAR') {
    foreach ($c in $Datos, $PgData, $Respaldos, $Runtime) { Remove-Item $c -Recurse -Force -ErrorAction SilentlyContinue }
    Ok 'Datos borrados'
  } else { Ok 'Datos conservados: si vuelve a instalar en esta carpeta, reaparecen.' }
}

# ----------------------------------------------------------------------------
# Punto de entrada
# ----------------------------------------------------------------------------
$Accion = $Accion.ToLower()
if ($RequiereAdmin -contains $Accion -and -not (Es-Administrador)) {
  # Se vuelve a abrir con permisos de administrador.
  $argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", $Accion)
  if ($Argumento) { $argumentos += "`"$Argumento`"" }
  if ($Demo) { $argumentos += '-Demo' }
  if ($Destino) { $argumentos += @('-Destino', "`"$Destino`"") }
  $argumentos += '-Pausa'
  try { Start-Process powershell.exe -Verb RunAs -ArgumentList $argumentos }
  catch { Write-Host 'Se necesitan permisos de administrador.' -ForegroundColor Red }
  exit
}

$codigoSalida = 0
try {
  switch ($Accion) {
    'instalar' { Accion-Instalar }
    'estado' { Mostrar-Estado }
    'crear-usuario' { Crear-Usuario }
    'respaldar' { Respaldar }
    'restaurar' { Restaurar $Argumento }
    'programar-respaldo' { Programar-Respaldo $Argumento }
    'actualizar' { Accion-Actualizar }
    'correo' { Configurar-Correo }
    'borrar-demo' { Borrar-Demo }
    'reiniciar' { Iniciar-App; if (Esperar-App) { Ok 'Plataforma reiniciada' } else { Mostrar-Registros } }
    'iniciar' { Iniciar-App; if (Esperar-App) { Ok 'Plataforma en marcha' } else { Mostrar-Registros } }
    'detener' { Stop-Service $ServicioApp -Force; Ok 'Plataforma detenida (la base de datos sigue en marcha)' }
    'logs' { Mostrar-Registros 80 }
    'desinstalar' { Accion-Desinstalar }
    default { Get-Help $PSCommandPath -Detailed | Out-Host }
  }
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  $codigoSalida = 1
}
if ($Pausa) {
  Write-Host ''
  Read-Host 'Presione Enter para cerrar' | Out-Null
}
exit $codigoSalida
