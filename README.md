# Plataforma de gestión FTTH

Plataforma web para administrar la red de fibra óptica de un ISP: mapa de la red, NAP y puertos, clientes, solicitudes de instalación con factibilidad, órdenes de trabajo para técnicos, inventario y estadísticas.

**Estado:** Etapa 1 de 6 completa (base de datos, autenticación, roles, panel). Ver [PROGRESO.md](PROGRESO.md).

## Arquitectura

- **Frontend**: React + TypeScript + Vite + Tailwind CSS, servido por Nginx en Docker.
- **Backend**: Supabase self-hosted: PostgreSQL 15 + PostGIS, Auth, API REST, Storage, Edge Functions.
- **Seguridad**: Row Level Security en todas las tablas; roles en tabla propia; la clave de servicio solo vive en el servidor.
- **Despliegue**: VPS con Dokploy, un servicio para Supabase y otro para el frontend.

Red modelada: OLT (puerto PON) → troncal (hilo) → NAP con splitter interno → acometida → cliente.

## Estructura

```
supabase/
  migrations/      esquema, reglas, RLS, auditoría e indicadores (SQL)
  tests/database/  pruebas pgTAP
  functions/       Edge Function admin-usuarios
  seed.sql         datos de demostración (es_demo = true)
frontend/          aplicación React
scripts/           dev.sh (entorno local), crear-admin.mjs (primer administrador)
docs/              modelo de datos, permisos, estados, decisiones, despliegue
```

## Desarrollo local

Requisitos: Docker y Node 20 o superior.

```bash
./scripts/dev.sh
```

Abre el frontend en http://localhost:5173 con datos de demostración. Instrucciones completas, incluido el primer administrador, en [docs/despliegue.md](docs/despliegue.md#entorno-local-desarrollo).

## Documentación

- [Modelo de datos](docs/modelo-datos.md)
- [Matriz de permisos](docs/permisos.md)
- [Estados y flujos](docs/estados.md)
- [Decisiones de diseño](docs/decisiones.md)
- [Despliegue en el VPS](docs/despliegue.md)

## Datos de demostración

Todo lo que carga `supabase/seed.sql` lleva `es_demo = true` y nombres que empiezan con "DEMO". Solo se carga en desarrollo. Para eliminarlo:

```sql
select public.eliminar_datos_demo();
```
