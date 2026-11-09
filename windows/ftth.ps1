<#
.SYNOPSIS
  Instala y administra la Plataforma FTTH en Windows 10/11 con Docker Desktop.

.DESCRIPTION
  Uso:  powershell -ExecutionPolicy Bypass -File ftth.ps1 <accion> [opciones]

  Acciones:
    instalar            Primera instalación (o reparar una existente). Opciones: -Ip, -Demo
    iniciar             Levanta todos los servicios
    detener             Detiene todos los servicios (los datos se conservan)
    estado              Muestra el estado de cada servicio y las direcciones de acceso
    logs [servicio]     Últimas líneas de registro (p. ej.: logs auth, logs web, logs db)
    crear-usuario       Crea un usuario con contraseña y rol
    respaldar           Respaldo de base de datos y fotos. Opción: -Destino <carpeta>
    programar-respaldo  Tarea diaria de Windows que ejecuta el respaldo. Opción: [HH:mm]
    actualizar          Respalda, reconstruye la aplicación y aplica migraciones nuevas
    cambiar-ip          Cambia la IP con la que se accede al sistema. Opción: -Ip
    certificado         Vuelve a exportar e instalar el certificado raíz en este PC

  Requiere Windows 10/11 Pro con Docker Desktop (motor WSL2, contenedores Linux).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Accion = 'ayuda',
  [Parameter(Position = 1)][string]$Argumento,
  [string]$Ip,
  [switch]$Demo,
  [string]$Destino
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

$Win = $PSScriptRoot
$Raiz = Split-Path -Parent $Win
$Stack = Join-Path $Win 'supabase-docker'
$EnvFile = Join-Path $Stack '.env'
$OverrideFile = Join-Path $Win 'docker-compose.ftth.yml'
$Certificado = Join-Path $Win 'certificado-ftth.crt'
$Migraciones = Join-Path $Raiz 'supabase\migrations'
$UrlLocal = 'http://localhost:8000'   # gateway de Supabase, solo accesible desde este PC
$Utf8SinBom = New-Object System.Text.UTF8Encoding($false)

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

# ----------------------------------------------------------------------------
# Programas externos
# ----------------------------------------------------------------------------
# Ejecuta un programa y captura su salida sin que PowerShell 5.1 convierta los
# mensajes de stderr en errores.
function Invoke-Nativo([string]$Exe, [string[]]$Argumentos) {
  $previo = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $salida = & $Exe @Argumentos 2>&1 | ForEach-Object { "$_" }
    $codigo = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previo }
  [pscustomobject]@{ Codigo = $codigo; Salida = ($salida -join "`n") }
}

function Argumentos-Compose {
  @('compose', '--project-name', 'ftth', '--project-directory', $Stack,
    '-f', (Join-Path $Stack 'docker-compose.yml'), '-f', $OverrideFile, '--env-file', $EnvFile)
}

# Docker Compose con salida en vivo. Devuelve solo el código de salida
# (la salida va a la consola con Out-Host para que no se mezcle con el retorno).
function Compose([string[]]$Resto) {
  $previo = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & docker @(Argumentos-Compose) @Resto | Out-Host; $codigo = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previo }
  return $codigo
}

function Psql([string[]]$Extra, [string]$Usuario = 'postgres') {
  Invoke-Nativo 'docker' (@('exec', '-i', 'supabase-db', 'psql', '-U', $Usuario, '-h', 'localhost',
      '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1') + $Extra)
}

# ----------------------------------------------------------------------------
# Archivo .env
# ----------------------------------------------------------------------------
function Leer-Env {
  if (-not (Test-Path $EnvFile)) { Falla 'No existe la configuración. Ejecute primero: ftth.ps1 instalar' }
  $valores = @{}
  foreach ($l in [IO.File]::ReadAllLines($EnvFile)) {
    if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $valores[$Matches[1]] = $Matches[2].Trim('"') }
  }
  return $valores
}

function Fijar-Env([System.Collections.IDictionary]$Cambios, [string]$Base) {
  $texto = if ($Base) { $Base } else { [IO.File]::ReadAllText($EnvFile) }
  $lineas = New-Object System.Collections.Generic.List[string]
  foreach ($l in ($texto -replace "`r", '') -split "`n") { $lineas.Add($l) }
  foreach ($clave in $Cambios.Keys) {
    $nueva = "$clave=$($Cambios[$clave])"
    $hallada = $false
    for ($i = 0; $i -lt $lineas.Count; $i++) {
      if ($lineas[$i] -match "^$([regex]::Escape($clave))=") { $lineas[$i] = $nueva; $hallada = $true }
    }
    if (-not $hallada) { $lineas.Add($nueva) }
  }
  $salida = (($lineas -join "`n").TrimEnd("`n")) + "`n"
  [IO.File]::WriteAllText($EnvFile, $salida, $Utf8SinBom)
}

function Hex([int]$bytes) {
  $b = New-Object byte[] $bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($b)
  return -join ($b | ForEach-Object { $_.ToString('x2') })
}

function Base64Url([byte[]]$b) {
  return [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# Clave de API de Supabase: JWT HS256 firmado con JWT_SECRET (válido 10 años).
function Nuevo-Jwt([string]$Secreto, [string]$Rol) {
  $ahora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $utf8 = [Text.Encoding]::UTF8
  $cabecera = '{"alg":"HS256","typ":"JWT"}'
  $carga = '{"role":"' + $Rol + '","iss":"supabase","iat":' + $ahora + ',"exp":' + ($ahora + 315360000) + '}'
  $datos = (Base64Url $utf8.GetBytes($cabecera)) + '.' + (Base64Url $utf8.GetBytes($carga))
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = $utf8.GetBytes($Secreto)
  return $datos + '.' + (Base64Url $hmac.ComputeHash($utf8.GetBytes($datos)))
}

function Valores-Url([string]$Direccion) {
  [ordered]@{
    FTTH_HOST                = $Direccion
    SUPABASE_PUBLIC_URL      = "https://$Direccion"
    API_EXTERNAL_URL         = "https://$Direccion/auth/v1"
    SITE_URL                 = "https://$Direccion"
    ADDITIONAL_REDIRECT_URLS = "https://$Direccion/establecer-clave"
  }
}

function Generar-Env([string]$Direccion) {
  $ejemplo = [IO.File]::ReadAllText((Join-Path $Stack '.env.example'))
  # Sin COMPOSE_FILE: ftth.ps1 indica los archivos explícitamente.
  $ejemplo = ($ejemplo -replace "`r", '') -replace '(?m)^COMPOSE_FILE=.*\n', ''
  $ejemplo = "# Configuración generada por ftth.ps1 el $(Get-Date -Format 'dd-MM-yyyy HH:mm').`n" +
  "# Contiene claves secretas: no la comparta ni la suba a GitHub.`n" + $ejemplo
  $jwt = Hex 32
  $valores = [ordered]@{
    POSTGRES_PASSWORD             = Hex 24
    JWT_SECRET                    = $jwt
    ANON_KEY                      = Nuevo-Jwt $jwt 'anon'
    SERVICE_ROLE_KEY              = Nuevo-Jwt $jwt 'service_role'
    DASHBOARD_USERNAME            = 'supabase'
    DASHBOARD_PASSWORD            = Hex 12
    SECRET_KEY_BASE               = Hex 48
    REALTIME_DB_ENC_KEY           = Hex 8
    VAULT_ENC_KEY                 = Hex 16
    PG_META_CRYPTO_KEY            = Hex 24
    LOGFLARE_PUBLIC_ACCESS_TOKEN  = Hex 24
    LOGFLARE_PRIVATE_ACCESS_TOKEN = Hex 24
    S3_PROTOCOL_ACCESS_KEY_ID     = Hex 16
    S3_PROTOCOL_ACCESS_KEY_SECRET = Hex 32
    MINIO_ROOT_PASSWORD           = Hex 16
    POOLER_TENANT_ID              = 'ftth'
    STUDIO_DEFAULT_ORGANIZATION   = 'FTTH'
    STUDIO_DEFAULT_PROJECT        = 'Plataforma FTTH'
    OPENAI_API_KEY                = ''
    DISABLE_SIGNUP                = 'true'
    ENABLE_EMAIL_SIGNUP           = 'true'
    ENABLE_EMAIL_AUTOCONFIRM      = 'false'
    ENABLE_ANONYMOUS_USERS        = 'false'
    ENABLE_PHONE_SIGNUP           = 'false'
    ENABLE_PHONE_AUTOCONFIRM      = 'false'
    FUNCTIONS_MEMORY_LIMIT        = '1g'
  }
  foreach ($k in (Valores-Url $Direccion).Keys) { $valores[$k] = (Valores-Url $Direccion)[$k] }
  Fijar-Env $valores $ejemplo
}

# ----------------------------------------------------------------------------
# Red
# ----------------------------------------------------------------------------
function Obtener-IpLocal {
  try {
    $cfg = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
      Select-Object -First 1
    if ($cfg) { return ($cfg.IPv4Address | Select-Object -First 1).IPAddress }
  } catch { }
  return ''
}

function Validar-Ip([string]$Texto) {
  $ipObj = $null
  if (-not [System.Net.IPAddress]::TryParse($Texto.Trim(), [ref]$ipObj) -or $ipObj.AddressFamily -ne 'InterNetwork') {
    Falla "La IP '$Texto' no es válida (ejemplo: 192.168.1.50)."
  }
  return $ipObj.ToString()
}

function Elegir-Ip {
  if ($Ip) { return Validar-Ip $Ip }
  $sugerida = Obtener-IpLocal
  $r = Read-Host "IP de este PC en la red local [$sugerida]"
  if ([string]::IsNullOrWhiteSpace($r)) { $r = $sugerida }
  if ([string]::IsNullOrWhiteSpace($r)) { Falla 'No se pudo detectar la IP. Ejecute de nuevo con -Ip 192.168.x.x' }
  return Validar-Ip $r
}

function Es-Administrador {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ----------------------------------------------------------------------------
# Comprobaciones de Docker
# ----------------------------------------------------------------------------
function Comprobar-Docker {
  Paso 'Comprobando Docker Desktop'
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Aviso 'Docker Desktop no está instalado.'
    if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Preguntar-SiNo '¿Instalarlo ahora con winget?')) {
      & winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
      Write-Host ''
      Aviso 'Docker Desktop quedó instalado. Reinicie Windows, abra Docker Desktop una vez (acepte los términos)'
      Aviso 'y vuelva a ejecutar Instalar.cmd.'
      exit 0
    }
    Falla 'Instale Docker Desktop desde https://www.docker.com/products/docker-desktop/ y vuelva a ejecutar.'
  }

  if ((Invoke-Nativo 'docker' @('info')).Codigo -ne 0) {
    $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $exe) {
      Info 'Iniciando Docker Desktop...'
      Start-Process $exe | Out-Null
      for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 3
        if ((Invoke-Nativo 'docker' @('info')).Codigo -eq 0) { break }
      }
    }
    if ((Invoke-Nativo 'docker' @('info')).Codigo -ne 0) {
      Falla 'Docker Desktop no responde. Ábralo, espere a que diga "Engine running" y vuelva a ejecutar.'
    }
  }

  $so = (Invoke-Nativo 'docker' @('info', '--format', '{{.OSType}}')).Salida.Trim()
  if ($so -ne 'linux') { Falla 'Docker está en modo "Windows containers". En Docker Desktop elija "Switch to Linux containers".' }

  $verTexto = (Invoke-Nativo 'docker' @('compose', 'version', '--short')).Salida.Trim().TrimStart('v')
  $ver = $null
  if ([version]::TryParse(($verTexto -replace '[^0-9.].*$', ''), [ref]$ver) -and $ver -lt [version]'2.24.4') {
    Falla "Docker Compose $verTexto es muy antiguo. Actualice Docker Desktop (se necesita Compose 2.24.4 o superior)."
  }

  $memTexto = (Invoke-Nativo 'docker' @('info', '--format', '{{.MemTotal}}')).Salida.Trim()
  $mem = 0.0
  if ([double]::TryParse($memTexto, [ref]$mem) -and $mem -gt 0) {
    $gb = [math]::Round($mem / 1GB, 1)
    if ($gb -lt 3.5) {
      Aviso "Docker tiene solo $gb GB de memoria. Se recomiendan 4 GB o más."
      Aviso 'Si el PC tiene 8 GB o más, cree %USERPROFILE%\.wslconfig con [wsl2] memory=6GB y reinicie.'
    } else { Ok "Docker listo (Compose $verTexto, $gb GB para contenedores)" }
  }
}

function Comprobar-Puertos {
  $propios = @('com.docker.backend', 'wslrelay', 'vpnkit', 'com.docker.proxy', 'docker-proxy', 'Docker Desktop')
  foreach ($puerto in 80, 443) {
    $conexiones = Get-NetTCPConnection -State Listen -LocalPort $puerto -ErrorAction SilentlyContinue
    foreach ($c in $conexiones) {
      $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      $nombre = if ($proc) { $proc.ProcessName } else { "PID $($c.OwningProcess)" }
      if ($propios -notcontains $nombre) {
        $extra = if ($c.OwningProcess -eq 4) { ' (servicio de Windows: IIS, "World Wide Web Publishing" u otro que usa HTTP.sys)' } else { '' }
        Falla "El puerto $puerto está ocupado por $nombre$extra. Deténgalo o desinstálelo y vuelva a ejecutar."
      }
    }
  }
  Ok 'Puertos 80 y 443 disponibles'
}

# ----------------------------------------------------------------------------
# Servicios
# ----------------------------------------------------------------------------
function Copiar-Funciones {
  $origen = Join-Path $Raiz 'supabase\functions\admin-usuarios'
  $destino = Join-Path $Stack 'volumes\functions\admin-usuarios'
  New-Item -ItemType Directory -Force -Path $destino | Out-Null
  Copy-Item -Path (Join-Path $origen '*') -Destination $destino -Recurse -Force
}

function Levantar([switch]$Construir) {
  Paso 'Descargando imágenes (la primera vez son unos 3 GB y puede tardar)'
  if ((Compose @('pull', '--ignore-buildable')) -ne 0) { Falla 'No se pudieron descargar las imágenes. Revise la conexión a internet.' }
  if ($Construir) {
    Paso 'Compilando la aplicación web'
    if ((Compose @('build', 'web')) -ne 0) {
      Falla 'Falló la compilación de la aplicación. Copie el texto de arriba y envíelo para revisarlo.'
    }
  }
  Paso 'Levantando servicios'
  if ((Compose @('up', '-d', '--remove-orphans', '--wait', '--wait-timeout', '600')) -ne 0) {
    Compose @('ps') | Out-Null
    Falla 'Algún servicio no quedó en buen estado. Revise con: ftth.ps1 estado  y  ftth.ps1 logs <servicio>'
  }
  Ok 'Todos los servicios están en marcha'
}

function Aplicar-Migraciones {
  Paso 'Base de datos: aplicando migraciones'
  $r = Psql @('-c', 'create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);')
  if ($r.Codigo -ne 0) { Falla "No se pudo preparar la tabla de migraciones:`n$($r.Salida)" }
  $r = Psql @('-tA', '-c', 'select version from supabase_migrations.schema_migrations')
  if ($r.Codigo -ne 0) { Falla "No se pudo leer el registro de migraciones:`n$($r.Salida)" }
  $aplicadas = @($r.Salida -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })

  $pendientes = Get-ChildItem -Path $Migraciones -Filter '*.sql' | Sort-Object Name |
    Where-Object { $aplicadas -notcontains ($_.BaseName -split '_', 2)[0] }
  if (-not $pendientes) { Ok 'La base de datos ya está al día'; return }

  foreach ($m in $pendientes) {
    $version, $nombre = $m.BaseName -split '_', 2
    $c = Invoke-Nativo 'docker' @('cp', $m.FullName, 'supabase-db:/tmp/ftth-migracion.sql')
    if ($c.Codigo -ne 0) { Falla "No se pudo copiar $($m.Name) al contenedor:`n$($c.Salida)" }
    $registro = "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$nombre') on conflict do nothing"
    $r = Psql @('-1', '-f', '/tmp/ftth-migracion.sql', '-c', $registro)
    if ($r.Codigo -ne 0 -and $r.Salida -match 'permission denied|must be owner|debe ser due') {
      Aviso "$($m.Name): faltan permisos con el usuario postgres; se reintenta como administrador de la base."
      $r = Psql @('-1', '-f', '/tmp/ftth-migracion.sql', '-c', $registro) 'supabase_admin'
    }
    if ($r.Codigo -ne 0) { Falla "Falló la migración $($m.Name) (no se aplicó nada de ella):`n$($r.Salida)" }
    if ($r.Salida -match 'pg_cron no disponible') { Aviso 'pg_cron no disponible: las reservas vencidas no se liberarán solas.' }
    Ok $m.Name
  }
  Invoke-Nativo 'docker' @('exec', 'supabase-db', 'rm', '-f', '/tmp/ftth-migracion.sql') | Out-Null
}

function Cargar-Demo {
  $r = Psql @('-tA', '-c', 'select count(*) from public.clientes where es_demo')
  if ($r.Codigo -eq 0 -and [int]($r.Salida.Trim()) -gt 0) { Ok 'Los datos de demostración ya estaban cargados'; return }
  $c = Invoke-Nativo 'docker' @('cp', (Join-Path $Raiz 'supabase\seed.sql'), 'supabase-db:/tmp/ftth-demo.sql')
  if ($c.Codigo -ne 0) { Falla "No se pudo copiar los datos de demostración:`n$($c.Salida)" }
  $r = Psql @('-1', '-f', '/tmp/ftth-demo.sql')
  if ($r.Codigo -ne 0) { Falla "No se pudieron cargar los datos de demostración:`n$($r.Salida)" }
  Ok 'Datos de demostración cargados (se borran con: select public.eliminar_datos_demo(); en Studio)'
}

function Configurar-Firewall {
  Paso 'Firewall de Windows'
  if (-not (Es-Administrador)) { Aviso 'Sin permisos de administrador: no se configuró el firewall (use Instalar.cmd).'; return }
  $nombre = 'Plataforma FTTH (HTTP/HTTPS)'
  if (-not (Get-NetFirewallRule -DisplayName $nombre -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $nombre -Direction Inbound -Protocol TCP -LocalPort 80, 443 `
      -Action Allow -Profile Private, Domain | Out-Null
  }
  Ok 'Puertos 80 y 443 abiertos para la red privada'
  $publicas = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' }
  foreach ($red in $publicas) {
    Aviso "La red '$($red.Name)' está marcada como Pública: los demás equipos no podrán entrar."
    if ((Es-Administrador) -and (Preguntar-SiNo "¿Marcar '$($red.Name)' como red Privada?")) {
      Set-NetConnectionProfile -InterfaceIndex $red.InterfaceIndex -NetworkCategory Private
      Ok "Red '$($red.Name)' marcada como Privada"
    }
  }
}

function Instalar-Certificado {
  Paso 'Certificado HTTPS local'
  $ruta = '/data/caddy/pki/authorities/local/root.crt'
  $listo = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ((Invoke-Nativo 'docker' @('cp', "ftth-proxy:$ruta", $Certificado)).Codigo -eq 0) { $listo = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $listo) { Aviso 'El certificado aún no está listo. Repita luego con: ftth.ps1 certificado'; return }
  Ok "Certificado raíz guardado en $Certificado"
  if (-not (Es-Administrador)) { Aviso 'Sin permisos de administrador: no se instaló el certificado en este PC.'; return }
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($Certificado)
  if (-not (Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })) {
    Import-Certificate -FilePath $Certificado -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
  }
  Ok 'Certificado instalado en este PC (los navegadores de este equipo confiarán en el sistema)'
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

function Mensaje-ErrorWeb($e) {
  if ($e.ErrorDetails -and $e.ErrorDetails.Message) {
    try {
      $j = $e.ErrorDetails.Message | ConvertFrom-Json
      foreach ($campo in 'msg', 'message', 'error_description', 'error') { if ($j.$campo) { return $j.$campo } }
    } catch { }
    return $e.ErrorDetails.Message
  }
  return $e.Exception.Message
}

function Crear-Usuario([string]$Correo) {
  $cfg = Leer-Env
  $roles = @('administrador', 'supervisor_red', 'tecnico', 'atencion_cliente', 'inventario')
  Paso 'Crear usuario'
  if (-not $Correo) { $Correo = Read-Host 'Correo' }
  if ($Correo -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Falla "Correo no válido: $Correo" }
  $nombre = Read-Host 'Nombre y apellido'
  Info 'Roles: 1) administrador  2) supervisor_red  3) tecnico  4) atencion_cliente  5) inventario'
  $sel = Read-Host 'Rol [1]'
  if ([string]::IsNullOrWhiteSpace($sel)) { $sel = '1' }
  $idx = 0
  if (-not [int]::TryParse($sel, [ref]$idx) -or $idx -lt 1 -or $idx -gt 5) { Falla "Opción de rol no válida: $sel" }
  $rol = $roles[$idx - 1]
  $clave = Leer-Clave

  $cab = @{ apikey = $cfg.SERVICE_ROLE_KEY; Authorization = "Bearer $($cfg.SERVICE_ROLE_KEY)" }
  $tipo = 'application/json; charset=utf-8'
  $cuerpo = @{ email = $Correo; password = $clave; email_confirm = $true; user_metadata = @{ nombre_completo = $nombre } } |
    ConvertTo-Json -Compress
  try {
    $u = Invoke-RestMethod -Method Post -Uri "$UrlLocal/auth/v1/admin/users" -Headers $cab -ContentType $tipo `
      -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo)) -UseBasicParsing
  } catch { Falla "No se pudo crear el usuario: $(Mensaje-ErrorWeb $_)" }

  $cab['Prefer'] = 'return=minimal'
  $cuerpoRol = @{ usuario_id = $u.id; rol = $rol } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Method Post -Uri "$UrlLocal/rest/v1/usuario_roles" -Headers $cab -ContentType $tipo `
      -Body ([Text.Encoding]::UTF8.GetBytes($cuerpoRol)) -UseBasicParsing | Out-Null
  } catch { Falla "El usuario se creó, pero no se pudo asignar el rol: $(Mensaje-ErrorWeb $_)" }
  Ok "Usuario creado: $Correo ($rol). Ya puede ingresar con esa contraseña."
}

# ----------------------------------------------------------------------------
# Respaldos
# ----------------------------------------------------------------------------
function Respaldar {
  $carpeta = if ($Destino) { $Destino } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'FTTH-respaldos' }
  New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
  $fecha = Get-Date -Format 'yyyy-MM-dd_HHmm'
  Paso "Respaldo en $carpeta"

  $r = Invoke-Nativo 'docker' @('exec', 'supabase-db', 'pg_dump', '-U', 'supabase_admin', '-h', 'localhost',
    '-d', 'postgres', '-Fc', '-f', '/tmp/ftth-respaldo.dump')
  if ($r.Codigo -ne 0) { Falla "Falló el respaldo de la base de datos:`n$($r.Salida)" }
  $archivoDb = Join-Path $carpeta "ftth_base_$fecha.dump"
  $c = Invoke-Nativo 'docker' @('cp', 'supabase-db:/tmp/ftth-respaldo.dump', $archivoDb)
  Invoke-Nativo 'docker' @('exec', 'supabase-db', 'rm', '-f', '/tmp/ftth-respaldo.dump') | Out-Null
  if ($c.Codigo -ne 0) { Falla "No se pudo copiar el respaldo:`n$($c.Salida)" }
  Ok "Base de datos: $archivoDb ($([math]::Round((Get-Item $archivoDb).Length / 1MB, 1)) MB)"

  $temporal = Join-Path $env:TEMP "ftth-archivos-$fecha"
  $c = Invoke-Nativo 'docker' @('cp', 'supabase-storage:/var/lib/storage', $temporal)
  if ($c.Codigo -eq 0 -and (Get-ChildItem -Recurse -File $temporal -ErrorAction SilentlyContinue)) {
    $archivoFotos = Join-Path $carpeta "ftth_fotos_$fecha.zip"
    Compress-Archive -Path (Join-Path $temporal '*') -DestinationPath $archivoFotos -Force
    Ok "Fotos de órdenes: $archivoFotos"
  } else { Info 'Fotos de órdenes: no hay archivos todavía.' }
  if (Test-Path $temporal) { Remove-Item -Recurse -Force $temporal }

  Copy-Item $EnvFile (Join-Path $carpeta "ftth_configuracion_$fecha.env")
  Ok 'Configuración (.env con claves): guárdela en un lugar seguro'

  # Conserva los 14 respaldos más recientes de cada tipo.
  foreach ($patron in 'ftth_base_*.dump', 'ftth_fotos_*.zip', 'ftth_configuracion_*.env') {
    Get-ChildItem -Path $carpeta -Filter $patron | Sort-Object Name -Descending | Select-Object -Skip 14 |
      Remove-Item -Force
  }
  Aviso 'Copie periódicamente esta carpeta a otro equipo o disco externo.'
}

function Programar-Respaldo([string]$Hora) {
  if (-not $Hora) { $Hora = '13:00' }
  $hora = [datetime]::ParseExact($Hora, 'HH:mm', $null)
  $accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" respaldar"
  $disparador = New-ScheduledTaskTrigger -Daily -At $hora
  $ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName 'Plataforma FTTH - Respaldo diario' -Action $accion -Trigger $disparador `
    -Settings $ajustes -Description 'Respaldo de base de datos y fotos de la Plataforma FTTH' -Force | Out-Null
  Ok "Respaldo diario programado a las $Hora (Programador de tareas: 'Plataforma FTTH - Respaldo diario')."
  Info 'Se ejecuta con la sesión de Windows iniciada (igual que Docker Desktop).'
}

# ----------------------------------------------------------------------------
# Resumen
# ----------------------------------------------------------------------------
function Mostrar-Accesos {
  $cfg = Leer-Env
  $h = $cfg.FTTH_HOST
  Write-Host ''
  Write-Host '  Plataforma FTTH' -ForegroundColor Green
  Write-Host "    Aplicación (PCs y celulares):  https://$h"
  Write-Host "    Certificado para otros equipos: http://$h/certificado.crt"
  Write-Host "    Studio (solo en este PC):       $UrlLocal   usuario: $($cfg.DASHBOARD_USERNAME)   clave: $($cfg.DASHBOARD_PASSWORD)"
  Write-Host ''
}

# ----------------------------------------------------------------------------
# Acciones
# ----------------------------------------------------------------------------
function Accion-Instalar {
  Write-Host 'Instalación de la Plataforma FTTH para Windows' -ForegroundColor Green
  Get-ChildItem -Path $Raiz -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
  Comprobar-Docker
  Comprobar-Puertos

  Paso 'Configuración'
  if (Test-Path $EnvFile) {
    Ok 'Se conserva la configuración existente (claves y contraseñas)'
    if ($Ip) { Fijar-Env (Valores-Url (Validar-Ip $Ip)); Ok "IP actualizada a $Ip" }
  } else {
    $direccion = Elegir-Ip
    Generar-Env $direccion
    Ok "Configuración creada para https://$direccion"
    Aviso 'Reserve esta IP en el router (o configúrela fija) para que no cambie.'
  }
  Copiar-Funciones

  Levantar -Construir
  Aplicar-Migraciones
  if ($Demo -or (Preguntar-SiNo '¿Cargar datos de demostración para probar?' $false)) { Cargar-Demo }
  Configurar-Firewall
  Instalar-Certificado

  $r = Psql @('-tA', '-c', 'select count(*) from public.usuario_roles where rol = ''administrador''')
  if ($r.Codigo -eq 0 -and [int]($r.Salida.Trim()) -eq 0) {
    Write-Host ''
    Info 'Falta crear el primer administrador.'
    Crear-Usuario ''
  }
  Mostrar-Accesos
  Info 'Para que todo arranque solo: en Docker Desktop active "Start Docker Desktop when you sign in".'
  Info 'Respaldo diario automático: ftth.ps1 programar-respaldo'
}

function Accion-Actualizar {
  Write-Host 'Actualización de la Plataforma FTTH' -ForegroundColor Green
  Comprobar-Docker
  if ((Test-Path (Join-Path $Raiz '.git')) -and (Get-Command git -ErrorAction SilentlyContinue)) {
    Paso 'Descargando la última versión desde GitHub'
    $g = Invoke-Nativo 'git' @('-C', $Raiz, 'pull', '--ff-only')
    if ($g.Codigo -ne 0) { Falla "git pull falló:`n$($g.Salida)" }
    Ok $g.Salida
  }
  Respaldar
  Copiar-Funciones
  Levantar -Construir
  Compose @('restart', 'functions') | Out-Null
  Aplicar-Migraciones
  Mostrar-Accesos
}

function Accion-CambiarIp {
  $direccion = Elegir-Ip
  Fijar-Env (Valores-Url $direccion)
  Paso "Aplicando la nueva IP $direccion"
  if ((Compose @('up', '-d', '--wait', '--wait-timeout', '300')) -ne 0) { Falla 'Revise con: ftth.ps1 estado' }
  Ok 'Listo. El certificado del sitio se renueva solo; los equipos no necesitan reinstalar el certificado raíz.'
  Mostrar-Accesos
}

try {
  switch ($Accion.ToLower()) {
    'instalar' { Accion-Instalar }
    'iniciar' { Comprobar-Docker; Copiar-Funciones; Levantar; Mostrar-Accesos }
    'detener' { Compose @('stop') | Out-Null; Ok 'Servicios detenidos. Los datos se conservan.' }
    'estado' { Compose @('ps', '--format', 'table {{.Service}}\t{{.Status}}') | Out-Null; Mostrar-Accesos }
    'logs' {
      $extra = @('logs', '--tail', '200')
      if ($Argumento) { $extra += $Argumento }
      Compose $extra | Out-Null
    }
    'crear-usuario' { Crear-Usuario $Argumento }
    'respaldar' { Respaldar }
    'programar-respaldo' { Programar-Respaldo $Argumento }
    'actualizar' { Accion-Actualizar }
    'cambiar-ip' { Accion-CambiarIp }
    'certificado' { Instalar-Certificado }
    default { Get-Help $PSCommandPath -Detailed | Out-Host }
  }
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
