# Plataforma FTTH en Windows (red local)

Instalación en un PC con **Windows 10/11 Pro** y **Docker Desktop**, para usar el
sistema dentro de la red de la oficina (PCs y celulares conectados al mismo Wi‑Fi o
por VPN). Es el mismo sistema que en un VPS, empaquetado para Windows.

## Requisitos

- Windows 10 (22H2) u 11, edición Pro, con virtualización activada en la BIOS.
- 8 GB de RAM como mínimo (16 GB recomendado) y 20 GB libres en disco.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) con el motor WSL2.
  Si no está, el instalador ofrece instalarlo con `winget`.
- Internet durante la instalación (descarga unos 3 GB de imágenes).
- Una IP fija para el PC (reserva DHCP en el router o IP estática).

## Instalar

1. Descomprima el repositorio en una carpeta sin espacios raros, por ejemplo `C:\FTTH`.
2. Abra la carpeta `windows` y haga doble clic en **Instalar.cmd** (pide permisos de administrador).
3. Confirme la IP del PC y siga las preguntas. Al final crea el primer administrador.

El instalador genera claves propias, levanta Supabase y la aplicación, crea la base de
datos, abre los puertos 80 y 443 en el firewall (red privada) e instala el certificado
HTTPS en este PC.

## Acceso

| Qué | Dirección |
|---|---|
| Aplicación (PCs y celulares) | `https://IP-DEL-PC` |
| Certificado para otros equipos | `http://IP-DEL-PC/certificado.crt` |
| Studio de Supabase (solo desde este PC) | `http://localhost:8000` (usuario y clave al final de la instalación, también en `supabase-docker\.env`) |

Cada PC o celular instala el certificado una sola vez; sin él, el navegador muestra
una advertencia y el GPS no funciona.

- **Android**: abrir `http://IP-DEL-PC/certificado.crt` → Ajustes → Seguridad → Cifrado y
  credenciales → Instalar un certificado → Certificado de CA.
- **iPhone**: abrir el enlace en Safari → Ajustes → Perfil descargado → Instalar; luego
  Ajustes → General → Información → Ajustes de confianza de certificados → activar.
- **Otros PCs con Windows**: doble clic en el archivo → Instalar certificado → Equipo local →
  "Entidades de certificación raíz de confianza".

## Uso diario

| Archivo | Para qué |
|---|---|
| `Estado.cmd` | Ver si todo está en marcha y las direcciones |
| `Crear-usuario.cmd` | Crear usuarios con contraseña (sin necesidad de correo) |
| `Respaldar.cmd` | Respaldo de base de datos, fotos y configuración en `Documentos\FTTH-respaldos` |
| `Actualizar.cmd` | Aplicar una versión nueva (respalda antes) |

Más opciones con PowerShell: `powershell -ExecutionPolicy Bypass -File ftth.ps1 ayuda`
(`logs`, `detener`, `iniciar`, `cambiar-ip`, `programar-respaldo`, `certificado`).

## Arranque automático

En Docker Desktop → Settings → General, active **Start Docker Desktop when you sign in**.
Los servicios se levantan solos cuando Docker arranca. Docker Desktop necesita que haya
una sesión de Windows iniciada: deje el PC con la sesión abierta (bloqueada está bien) o
configure el inicio de sesión automático.

## Cómo funciona

```
Celulares y PCs ──https──▶ proxy (Caddy, 80/443, certificado local)
                               └─▶ web (nginx: aplicación + /auth /rest /storage /functions)
                                        └─▶ Supabase (Postgres, Auth, API, Storage, Functions)
```

- `supabase-docker/`: copia fija y sin modificar del Supabase self-hosted oficial (ver `ORIGEN.md`).
- `docker-compose.ftth.yml`: lo propio de esta instalación (aplicación, proxy HTTPS,
  volúmenes de datos, puertos solo locales para Studio y la base de datos).
- Los datos viven en volúmenes de Docker (`ftth_ftth-db`, `ftth_ftth-archivos`), no en
  carpetas de Windows. **No ejecute `docker compose down -v`**: borra los datos.
