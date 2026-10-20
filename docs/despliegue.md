# Despliegue

La plataforma tiene dos piezas:

1. **Supabase self-hosted** (PostgreSQL + PostGIS, Auth, API REST, Storage, Edge Functions, Studio).
2. **Frontend**: archivos estáticos servidos por Nginx en un contenedor propio.

Ambas corren en el VPS (Ubuntu 24.04 + Dokploy), cada una como su propio servicio.

## Subdominios

| Subdominio (ejemplo) | Servicio | Público |
|---|---|---|
| `app.tu-isp.cl` | Frontend | Sí |
| `api.tu-isp.cl` | Supabase (Kong: API, Auth, Storage, Functions) | Sí |
| `studio.tu-isp.cl` | Supabase Studio | **No**: solo con autenticación y, idealmente, restringido por IP o por túnel SSH |

HTTPS lo emite Traefik (Dokploy) con Let's Encrypt.

## 1. Supabase self-hosted

1. En Dokploy, cree un proyecto y agregue Supabase. Dokploy trae una plantilla de Supabase; si no la tiene, use el `docker-compose.yml` oficial de la carpeta `docker/` del repositorio `supabase/supabase` como servicio de tipo *Docker Compose*. La imagen de Postgres de Supabase ya incluye PostGIS.
2. Variables de entorno (las de `.env.example` oficial). Las importantes:

   | Variable | Valor |
   |---|---|
   | `POSTGRES_PASSWORD` | Contraseña larga y aleatoria |
   | `JWT_SECRET` | Al menos 32 caracteres aleatorios |
   | `ANON_KEY`, `SERVICE_ROLE_KEY` | Generadas a partir de `JWT_SECRET` (la guía oficial de self-hosting explica cómo) |
   | `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` | Acceso a Studio; nunca los de ejemplo |
   | `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL` | `https://api.tu-isp.cl` |
   | `SITE_URL` | `https://app.tu-isp.cl` |
   | `ADDITIONAL_REDIRECT_URLS` | `https://app.tu-isp.cl/establecer-clave` |
   | `DISABLE_SIGNUP` | `true` (sin registro público) |
   | `ENABLE_EMAIL_AUTOCONFIRM` | `false` |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME` | Servidor de correo para invitaciones y recuperación de contraseña |

   La `SERVICE_ROLE_KEY` nunca se usa en el frontend ni se sube al repositorio.

3. **Edge Function**: copie `supabase/functions/admin-usuarios/` dentro del volumen de funciones del servicio (`volumes/functions/admin-usuarios/` en el compose oficial) y agregue `SITE_URL=https://app.tu-isp.cl` al servicio `functions`. Reinicie ese servicio.

4. **Studio**: en Dokploy no le asigne dominio público, o asígnelo con restricción por IP. Alternativa segura: acceder por túnel SSH (`ssh -L 8000:localhost:8000 usuario@vps`).

## 2. Migraciones de base de datos

Desde su computador, con un túnel SSH al Postgres del VPS:

```bash
# Terminal 1: túnel (ajuste el puerto si su compose publica otro)
ssh -N -L 5433:localhost:5432 usuario@vps

# Terminal 2: aplicar migraciones (no aplica los datos de demostración)
npx supabase@2 db push --db-url "postgresql://postgres:POSTGRES_PASSWORD@localhost:5433/postgres"
```

`db push` registra qué migraciones ya se aplicaron; volver a ejecutarlo solo aplica las nuevas.

Si el puerto de Postgres no está publicado en el VPS, puede aplicar cada archivo de `supabase/migrations/` en orden con `docker exec -i <contenedor-db> psql -U postgres -d postgres < archivo.sql`, pero en ese caso debe llevar usted el control de cuáles ya se aplicaron.

## 3. Primer administrador

```bash
SUPABASE_URL=https://api.tu-isp.cl \
SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
node scripts/crear-admin.mjs admin@tu-isp.cl "Nombre Apellido"
```

El script pide la contraseña por consola. Luego ingrese en `https://app.tu-isp.cl` y, desde **Usuarios**, invite al resto del equipo. Cada invitado recibe un correo para crear su contraseña.

Configure también el nombre de la empresa (aparece en el menú y el login):

```sql
update public.configuracion set valor = '"Nombre de su ISP"' where clave = 'nombre_empresa';
```

## 4. Frontend

En Dokploy, cree una aplicación conectada a este repositorio de GitHub:

- **Build type**: Dockerfile
- **Docker context path**: `frontend`
- **Dockerfile path**: `frontend/Dockerfile`
- **Variables de entorno**:
  - `SUPABASE_URL=https://api.tu-isp.cl`
  - `SUPABASE_ANON_KEY=<anon_key>`
- **Dominio**: `app.tu-isp.cl`, puerto 80, HTTPS activado.

La imagen genera `/config.js` al arrancar con esas variables, así que cambiar de servidor no requiere recompilar. El contenedor expone `/salud` para el chequeo de estado.

Alternativa: desplegar `docker-compose.yml` de la raíz como servicio *Docker Compose*.

## 5. Respaldos (mínimo mientras se completa la Etapa 6)

Mientras se implementa el respaldo automático con rotación, haga al menos un respaldo diario desde el VPS:

```bash
docker exec <contenedor-db> pg_dump -U postgres -d postgres -Fc > ftth_$(date +%F).dump
```

Y copie esos archivos fuera del VPS. La Etapa 6 agrega el script programado, la rotación, el respaldo de Storage y la restauración probada.

## Entorno local (desarrollo)

Requisitos: Docker, Node 20 o superior.

```bash
./scripts/dev.sh
```

Levanta Supabase local con migraciones y datos de demostración, las Edge Functions y el frontend en `http://localhost:5173`. Los correos de invitación se ven en `http://127.0.0.1:54324`. Para crear el administrador local:

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=$(npx supabase@2 status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2 | tr -d '"') \
node scripts/crear-admin.mjs admin@local.test "Admin Local"
```

Pruebas de base de datos: `npx supabase@2 test db`. Pruebas del frontend: `cd frontend && npm test`.
