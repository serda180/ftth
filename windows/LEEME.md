# Plataforma FTTH en Windows

Se instala en un PC con **Windows 10/11 Pro** de la oficina (el "PC servidor") y se usa
desde cualquier PC o celular conectado a la misma red (cable, Wi‑Fi o VPN).

## Requisitos del PC servidor

- Windows 10 (22H2) u 11, edición Pro, con la virtualización activada en la BIOS.
- 8 GB de RAM como mínimo (16 GB recomendado) y 20 GB libres en disco.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/). Si no está, el instalador ofrece instalarlo.
- Internet durante la instalación (descarga unos 3 GB).
- IP fija: reserve la IP del PC en el router.

## Instalar (una sola vez)

1. Descomprima el sistema en `C:\ftth`.
2. Doble clic en **`C:\ftth\INSTALAR.cmd`** y acepte el permiso de administrador.
3. Responda las preguntas (casi todas basta con Enter) y cree el primer administrador.

La primera vez tarda de 10 a 20 minutos. Si se interrumpe, vuelva a ejecutar `INSTALAR.cmd`:
conserva las claves y los datos.

## Usar

Doble clic en el ícono **Plataforma FTTH** del escritorio. Si hace falta, inicia Docker
Desktop y la plataforma (aparece una ventana pequeña con el avance) y abre el navegador.

Si eligió el inicio automático, la plataforma arranca sola al iniciar sesión en Windows.

En el **menú Inicio → Plataforma FTTH** están además:

| Acceso | Para qué |
|---|---|
| Crear usuario | Usuario con contraseña y rol, sin necesidad de correo |
| Respaldar | Base de datos, fotos y configuración en `Documentos\FTTH-respaldos` (guarda los últimos 14) |
| Estado | Si cada servicio está en marcha y las direcciones de acceso |
| Detener | Apaga la plataforma (los datos se conservan) |
| Actualizar | Instala una versión nueva (respalda antes) |

Docker Desktop necesita una sesión de Windows iniciada: deje el PC servidor encendido y
con la sesión abierta (bloqueada está bien).

## Entrar desde otros PCs y celulares

Dirección: `https://IP-DEL-PC-SERVIDOR` (la muestran el instalador y "Estado").

Cada equipo instala una vez el certificado de la oficina desde
`http://IP-DEL-PC-SERVIDOR/certificado.crt`. Sin él, el navegador muestra una advertencia
y el GPS no funciona.

- **Android**: Ajustes → Seguridad → Cifrado y credenciales → Instalar un certificado →
  Certificado de CA → elegir el archivo descargado.
- **iPhone**: abrir el enlace en Safari → Ajustes → Perfil descargado → Instalar; luego
  Ajustes → General → Información → Ajustes de confianza de certificados → activar.
- **PCs con Windows**: doble clic en el archivo → Instalar certificado → Equipo local →
  "Entidades de certificación raíz de confianza".

En el celular, el menú del navegador → **Agregar a pantalla de inicio** deja la aplicación
como un ícono más.

## Actualizar

Descomprima la versión nueva sobre `C:\ftth` (reemplazar archivos) y use **Actualizar**
en el menú Inicio. La configuración y los datos se conservan.

## Avanzado

Todo lo hace `windows\ftth.ps1`. Desde PowerShell en esa carpeta:

```powershell
powershell -ExecutionPolicy Bypass -File ftth.ps1 ayuda
```

Acciones extra: `logs <servicio>`, `cambiar-ip -Ip 192.168.1.60`, `programar-respaldo 13:00`,
`certificado`, `accesos` y `desinstalar`. El registro del ícono de inicio queda en
`%LOCALAPPDATA%\PlataformaFTTH\inicio.log`.

Studio (panel de Supabase, solo en el PC servidor): `http://localhost:8000`, con el usuario
y la clave que muestra "Estado".

### Cómo funciona

```
Celulares y PCs ──https──▶ proxy (Caddy, 80/443, certificado local)
                               └─▶ web (nginx: aplicación + /auth /rest /storage /functions)
                                        └─▶ Supabase (Postgres, Auth, API, Storage, Functions)
```

- `supabase-docker/`: copia fija y sin modificar del Supabase self-hosted oficial (ver `ORIGEN.md`).
- `docker-compose.ftth.yml`: lo propio de esta instalación (aplicación, proxy HTTPS,
  volúmenes de datos, Studio y base de datos solo accesibles desde el PC servidor).
- Las claves quedan en `supabase-docker\.env`: no lo borre ni lo comparta.
- Los datos viven en volúmenes de Docker (`ftth_ftth-db`, `ftth_ftth-archivos`). No use
  `docker compose down -v`: los borra.
