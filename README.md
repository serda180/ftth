# Plataforma de gestión FTTH

Plataforma web para administrar la red de fibra óptica de un ISP: mapa de la red, NAP y puertos, clientes, solicitudes de instalación con factibilidad, órdenes de trabajo para técnicos, inventario y estadísticas.

Se instala en un **PC con Windows 10/11 Pro** de la oficina y se usa desde cualquier PC o celular de la red local.

**Estado:** Etapas 1 a 4 de 6 completas (base, mapa GIS, clientes, puertos, conexiones, topología, solicitudes, factibilidad, órdenes de trabajo y app del técnico) e instalador para Windows. Ver [PROGRESO.md](PROGRESO.md).

## Instalar

1. Instale [Docker Desktop](https://www.docker.com/products/docker-desktop/) (o deje que el instalador lo haga).
2. Descomprima esta carpeta en `C:\ftth`.
3. Doble clic en **`INSTALAR.cmd`**.

Después, para usarla: doble clic en el ícono **Plataforma FTTH** del escritorio. Guía completa en [windows/LEEME.md](windows/LEEME.md).

## Arquitectura

- **Frontend**: React + TypeScript + Vite + Tailwind CSS, servido por Nginx.
- **Backend**: Supabase self-hosted: PostgreSQL + PostGIS, Auth, API REST, Storage, Edge Functions.
- **Seguridad**: Row Level Security en todas las tablas; roles en tabla propia; la clave de servicio solo vive en el PC servidor.
- **En Windows**: todo corre en Docker Desktop; Caddy entrega HTTPS en la red local con un certificado propio (necesario para el GPS de los celulares).

Red modelada: OLT (puerto PON) → troncal (hilo) → NAP con splitter interno → acometida → cliente.

## Estructura

```
INSTALAR.cmd       instalador (doble clic)
windows/           script de instalación y administración, proxy HTTPS, copia fija de Supabase
supabase/
  migrations/      esquema, reglas, RLS, auditoría e indicadores (SQL)
  tests/           pruebas pgTAP y de concurrencia
  functions/       Edge Function admin-usuarios
  seed.sql         datos de demostración (es_demo = true)
frontend/          aplicación React
docs/              modelo de datos, permisos, estados, decisiones
```

## Desarrollo y pruebas

Cada cambio enviado a GitHub corre la integración continua (`.github/workflows/ci.yml`): migraciones y pruebas pgTAP en Supabase, prueba de concurrencia de puertos, y tipos, pruebas y compilación del frontend.

Para probar a mano: `npx supabase@2 db start && npx supabase@2 test db` (base de datos) y `cd frontend && npm install && npm test && npm run build` (frontend).

## Documentación

- [Instalación y uso en Windows](windows/LEEME.md)
- [Modelo de datos](docs/modelo-datos.md)
- [Matriz de permisos](docs/permisos.md)
- [Estados y flujos](docs/estados.md)
- [Decisiones de diseño](docs/decisiones.md)

## Datos de demostración

Todo lo que carga `supabase/seed.sql` lleva `es_demo = true` y nombres que empiezan con "DEMO". El instalador pregunta si cargarlos. Para eliminarlos, en Studio (`http://localhost:8000`, SQL Editor):

```sql
select public.eliminar_datos_demo();
```
