# Progreso

Estados: **implementado y probado** · **implementado sin pruebas** · **solo interfaz** · **pendiente**

Última actualización: 20-10-2026 — fin de la Etapa 1.

## Etapa 1 — Base

| Módulo | Estado | Notas |
|---|---|---|
| Modelo de datos completo (migraciones 0001–0010) | implementado y probado | 82 pruebas pgTAP. Probado en PostgreSQL 16 con PostGIS simulado; falta correr en Supabase real (`supabase test db`). |
| Validación de RUT y teléfono (base y frontend) | implementado y probado | Mismas reglas en SQL y TypeScript, con pruebas en ambos. |
| Roles, RLS y protecciones de cuentas | implementado y probado | Matriz en `docs/permisos.md`. |
| Auditoría por disparadores | implementado y probado | |
| Puertos de NAP e hilos de cable automáticos | implementado y probado | Esquema y reglas listos; la interfaz llega en la Etapa 2. |
| Inventario: costo más alto, stock, consumo del técnico | implementado y probado | Esquema y reglas listos; la interfaz llega en la Etapa 5. |
| Indicadores del panel (`dashboard_indicadores`) | implementado y probado | |
| Datos de demostración y su eliminación | implementado y probado | `supabase/seed.sql`, `eliminar_datos_demo()`. |
| Edge Function `admin-usuarios` (invitar, desactivar, reactivar) | implementado sin pruebas | No se pudo ejecutar el runtime de Supabase en el entorno de desarrollo. |
| Frontend: ingreso, recuperación y creación de contraseña | implementado sin pruebas | Escrito, no compilado aún: el entorno de desarrollo no tenía acceso a npm. |
| Frontend: menú lateral por rol, panel de indicadores | implementado sin pruebas | Ídem. |
| Frontend: usuarios (invitar, roles, activar/desactivar) | implementado sin pruebas | Ídem. |
| Frontend: "Mis órdenes" del técnico (lectura) | implementado sin pruebas | Cambiar estado y cerrar órdenes desde el teléfono llega en la Etapa 4. |
| Frontend: utilidades (RUT, formatos CLP y fechas) | implementado y probado | Pruebas unitarias ejecutadas. |
| Docker del frontend (Nginx, `/config.js`, CSP) | implementado sin pruebas | Script de arranque probado; la imagen no se construyó. |
| Entorno local con un comando (`scripts/dev.sh`) | implementado sin pruebas | |
| CI en GitHub Actions | implementado sin pruebas | Corre pgTAP y la compilación del frontend en cada push. |

## Etapas siguientes

| Etapa | Estado |
|---|---|
| 2 — Mapa GIS, elementos, cables, NAP | pendiente |
| 3 — Clientes, puertos, conexiones, topología | pendiente (esquema listo) |
| 4 — Solicitudes, factibilidad, órdenes, app del técnico, fotos | pendiente (esquema de solicitudes y órdenes listo) |
| 5 — Inventario (interfaz), estadísticas, auditoría (interfaz) | pendiente (reglas de inventario listas) |
| 6 — Importación/exportación, respaldos, E2E, despliegue | pendiente |

## Verificación pendiente de la Etapa 1

Primera ejecución con Docker y npm disponibles:

1. `./scripts/dev.sh` levanta todo sin errores.
2. `npx supabase@2 test db` pasa las 82 pruebas en Supabase real.
3. `cd frontend && npm run typecheck && npm test && npm run build` pasa.
4. Crear administrador, invitar un técnico y un usuario de atención, y comprobar que el técnico no ve el panel ni clientes ajenos.
