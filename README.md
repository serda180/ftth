# Plataforma de gestión FTTH

Plataforma web para administrar la red de fibra óptica de un ISP: mapa de la red, NAP y puertos, clientes, solicitudes de instalación con factibilidad, órdenes de trabajo para técnicos, inventario y estadísticas.

Se instala en un **PC con Windows 10/11** de la oficina, sin Docker, y se usa desde cualquier PC o celular de la red local.

**Estado:** Etapas 1 a 4 de 6 completas (base, mapa GIS, clientes, puertos, conexiones, topología, solicitudes, factibilidad, órdenes de trabajo y app del técnico) e instalador para Windows. Ver [PROGRESO.md](PROGRESO.md).

## Instalar

1. Descomprima esta carpeta en `C:\ftth`.
2. Doble clic en **`INSTALAR.cmd`**.

Después: doble clic en **Plataforma FTTH** del escritorio. La plataforma arranca sola con Windows. Guía completa en [windows/LEEME.md](windows/LEEME.md).

## Arquitectura

```
Celulares y PCs ──https──▶ servidor (Node.js, servicio "PlataformaFTTH", puertos 80/443)
                              ├─ aplicación web (React compilada)
                              ├─ /auth, /storage, /functions  (servidor/lib)
                              └─ /rest ──▶ PostgREST (127.0.0.1) ──▶ PostgreSQL 17 + PostGIS
                                                                    (servicio "PlataformaFTTH-BaseDatos", 127.0.0.1)
```

- **Frontend**: React + TypeScript + Vite + Tailwind CSS, cliente `supabase-js`.
- **Base de datos**: PostgreSQL + PostGIS con Row Level Security en todas las tablas; roles en tabla propia.
- **Servidor** (`servidor/`): reemplaza a Supabase Auth, Storage y Edge Functions con el mismo protocolo, sin dependencias de npm; HTTPS con una autoridad certificadora local (necesario para el GPS de los celulares).
- **API de datos**: PostgREST, el mismo motor que usa Supabase.

Red modelada: OLT (puerto PON) → troncal (hilo) → NAP con splitter interno → acometida → cliente.

## Estructura

```
INSTALAR.cmd       instalador (doble clic)
windows/           ftth.ps1: instalación, servicios, respaldos, actualización
servidor/          servidor HTTPS + auth + fotos + usuarios; sql/ con el entorno base
supabase/
  migrations/      esquema, reglas, RLS, auditoría e indicadores (SQL)
  tests/           pruebas pgTAP y de concurrencia
  seed.sql         datos de demostración (es_demo = true)
frontend/          aplicación React
docs/              modelo de datos, permisos, estados, decisiones
```

## Desarrollo y pruebas

Cada cambio enviado a GitHub corre la integración continua (`.github/workflows/ci.yml`): migraciones y pruebas pgTAP, prueba de concurrencia de puertos, y tipos, pruebas y compilación del frontend.

Para probar a mano: `npx supabase@2 db start && npx supabase@2 test db` (base de datos) y `cd frontend && npm install && npm test && npm run build` (frontend).

## Documentación

- [Instalación y uso en Windows](windows/LEEME.md)
- [Modelo de datos](docs/modelo-datos.md)
- [Matriz de permisos](docs/permisos.md)
- [Estados y flujos](docs/estados.md)
- [Decisiones de diseño](docs/decisiones.md)

## Datos de demostración

Todo lo que carga `supabase/seed.sql` lleva `es_demo = true` y nombres que empiezan con "DEMO". El instalador pregunta si cargarlos; se borran con **Borrar datos de demostración** del menú Inicio (o `select public.eliminar_datos_demo();`).
