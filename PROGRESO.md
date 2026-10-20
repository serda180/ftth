# Progreso

Estados: **implementado y probado** · **implementado sin pruebas** · **solo interfaz** · **pendiente**

Última actualización: 20-10-2026 — fin de la Etapa 3.

## Etapa 1 — Base

| Módulo | Estado | Notas |
|---|---|---|
| Modelo de datos completo (migraciones 0001–0010) | implementado y probado | Pruebas pgTAP (140 en total con las Etapas 2 y 3). Probado en PostgreSQL 16 con PostGIS simulado; falta correr en Supabase real (`supabase test db`). |
| Validación de RUT y teléfono (base y frontend) | implementado y probado | Mismas reglas en SQL y TypeScript, con pruebas en ambos. |
| Roles, RLS y protecciones de cuentas | implementado y probado | Matriz en `docs/permisos.md`. |
| Auditoría por disparadores | implementado y probado | |
| Puertos de NAP e hilos de cable automáticos | implementado y probado | Se ven y gestionan desde el mapa (Etapa 2). |
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

## Etapa 2 — Mapa GIS

| Módulo | Estado | Notas |
|---|---|---|
| Funciones SQL del mapa (migración 0011): carga por zona con agrupación, alta/edición/movimiento/baja de elementos y cables, búsqueda, fichas | implementado y probado | 26 pruebas nuevas (`07_mapa.test.sql`), incluido el ajuste de extremos y el cálculo de longitud. |
| Guardia de estados de puerto (libre ↔ averiado) | implementado y probado | |
| Cálculos de distancia en el navegador | implementado y probado | Pruebas unitarias; coinciden con PostGIS. |
| Mapa: capas, filtros por tipo/estado/sector, leyenda, satélite, mi ubicación | implementado sin pruebas | Sin compilar aún (entorno sin npm). |
| Mapa: agregar elementos de cualquier tipo con sus datos propios | implementado sin pruebas | |
| Mapa: dibujar cables con unión a elementos, editar trazado, medir | implementado sin pruebas | |
| Mapa: ficha de NAP con grilla de puertos, alimentación y cambio libre/averiado | implementado sin pruebas | |
| Mapa: ficha de cable con hilos por tubo y color | implementado sin pruebas | |
| Búsqueda por código, nombre, dirección, sector y RUT | implementado sin pruebas (función SQL probada) | |
| Importar/exportar GeoJSON y KML | pendiente | Etapa 6. |
| Clientes en el mapa | implementado sin pruebas | Etapa 3 (función SQL probada). |

## Etapa 3 — Clientes, puertos, conexiones y topología

| Módulo | Estado | Notas |
|---|---|---|
| Asignación y liberación transaccional de puertos (`asignar_puerto_cliente`, `liberar_puerto_cliente`) | implementado y probado | pgTAP + prueba de concurrencia: 10 sesiones simultáneas por el mismo puerto, solo una lo obtiene. |
| Retiro de cliente libera su puerto; el puerto no se cambia con UPDATE directo | implementado y probado | |
| Conexiones: alimentar NAP, inyectar hilo desde PON, empalmes, verificar, quitar | implementado y probado | El estado de los hilos se sincroniza solo. |
| Camino NAP → OLT, ruta del cliente, impacto, topología | implementado y probado | |
| NAP cercanas con puertos libres y ruta; detección de duplicados | implementado y probado | |
| Vista `clientes_vista` con RLS | implementado y probado | |
| Clientes: listado con búsqueda, filtros, paginación y exportación CSV | implementado sin pruebas | Sin compilar aún (entorno sin npm). |
| Clientes: alta y edición con RUT, ubicación en mapa y aviso de duplicados | implementado sin pruebas | |
| Clientes: ficha con asignar/cambiar/liberar puerto, ruta, estado e historial con notas | implementado sin pruebas | |
| Mapa: capa de clientes con acometida a su NAP | implementado sin pruebas | |
| Mapa: alimentación de NAP e inyección por PON desde las fichas | implementado sin pruebas | |
| Impacto en fichas de cable/elemento (automático si está fuera de servicio) y exportación de afectados | implementado sin pruebas | |
| Página de topología con análisis de impacto | implementado sin pruebas | |
| Configuración: planes y parámetros | implementado sin pruebas | |
| Exportación CSV | implementado y probado | Prueba unitaria. |
| Órdenes masivas para afectados | pendiente | Etapa 4 (órdenes de trabajo). |

## Etapas siguientes

| Etapa | Estado |
|---|---|
| 4 — Solicitudes, factibilidad, órdenes, app del técnico, fotos | pendiente (esquema de solicitudes y órdenes listo) |
| 5 — Inventario (interfaz), estadísticas, auditoría (interfaz) | pendiente (reglas de inventario listas) |
| 6 — Importación/exportación, respaldos, E2E, despliegue | pendiente |

## Verificación pendiente (Etapas 1 a 3)

Primera ejecución con Docker y npm disponibles:

1. `./scripts/dev.sh` levanta todo sin errores.
2. `npx supabase@2 test db` pasa las 140 pruebas en Supabase real (con PostGIS de verdad), y `bash supabase/tests/concurrencia/asignacion_puertos.sh` pasa.
3. `cd frontend && npm run typecheck && npm test && npm run build` pasa.
4. Crear administrador, invitar un técnico y un usuario de atención, y comprobar que el técnico no ve el panel ni clientes ajenos.
5. En el mapa, como supervisor: crear dos elementos, dibujar un cable entre ellos, crear una NAP y ver sus puertos; recargar y comprobar que todo persiste (criterio de término de la Etapa 2).
6. Crear un plan en Configuración, registrar un cliente, asignarle un puerto, registrar la alimentación de su NAP y la inyección del hilo en la OLT; ver su ruta completa; marcar el troncal fuera de servicio y ver al cliente entre los afectados (criterio de término de la Etapa 3).
