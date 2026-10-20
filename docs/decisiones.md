# Decisiones de diseño

Registro de decisiones tomadas durante el desarrollo, con su motivo. Las marcadas **(revisar)** conviene confirmarlas con la empresa.

| # | Decisión | Motivo |
|---|---|---|
| 1 | Herencia por tablas: `elementos_red` + una tabla de detalle por clase, unidas por clave foránea compuesta `(id, clase)`. | Evita una tabla genérica y permite que cables y conexiones apunten a cualquier elemento con integridad referencial. |
| 2 | La tabla de hilos se llama `cable_hilos` (no `troncal_hilos`) y se genera para todo cable. | Un cable de derivación o distribución también tiene fibras numeradas; la misma lógica sirve para todos. |
| 3 | El enlace puerto de NAP → cliente se guarda en `clientes.nap_puerto_id`, no en `conexiones`. | Ese vínculo ya es explícito y tiene su propia restricción de unicidad; duplicarlo en `conexiones` crearía dos fuentes de verdad. |
| 4 | El inyección OLT → hilo se registra solo en `conexiones` (no como columna del hilo). | Una sola fuente de verdad para la topología. |
| 5 | La capacidad de la NAP es independiente del ratio del splitter; la interfaz sugiere la capacidad al elegir el ratio. | Algunas NAP tienen más puertos físicos que salidas del splitter o se amplían después. |
| 6 | Se precargan las 16 regiones y solo las 33 comunas del Biobío. **(revisar)** | Es la zona de operación; las demás se agregan desde configuración si se necesitan, sin arriesgar errores en un listado largo. |
| 7 | El RUT del cliente es obligatorio; en solicitudes es opcional. **(revisar)** | El contrato lo exige; en el primer contacto puede no estar disponible. |
| 8 | Ubicación del cliente opcional en la base. | Permite importar clientes antiguos sin coordenadas; la interfaz la exigirá al crear clientes nuevos. |
| 9 | Valorización de inventario por costo más alto de compra. | Decisión de la empresa. El costo vigente se guarda en cada movimiento para que los reportes históricos no cambien. |
| 10 | Un artículo nuevo parte con costo 0 y solo lo fijan las compras o un ajuste del administrador. | Que el costo refleje siempre la regla del precio más alto pagado. |
| 11 | Movimientos de inventario inmutables. | Trazabilidad: una corrección es otro movimiento (ajuste) y queda registrada. |
| 12 | Se usa Supabase CLI para el entorno local (`supabase start`) en lugar de un docker-compose propio. | Es la forma soportada por Supabase de levantar todo el stack local, aplica migraciones y seed, y corre las pruebas pgTAP. |
| 13 | El frontend lee la URL y la clave pública de Supabase desde `/config.js`, generado al arrancar el contenedor. | La misma imagen sirve para cualquier entorno; se configura con variables de Dokploy sin recompilar. |
| 14 | Los usuarios se crean solo por invitación de un administrador (Edge Function `admin-usuarios`); el registro público queda deshabilitado. | Requisito de seguridad. La clave de servicio solo vive en la Edge Function. |
| 15 | Los valores típicos de configuración (250 m, 28 dB, −8/−27 dBm, 72 h, 80 %) vienen de los ejemplos del requerimiento. **(revisar)** | Son editables en la tabla `configuracion`. |
| 16 | Fotos de órdenes (Storage) se implementan en la Etapa 4. | Es cuando se construye la vista del técnico que las usa. |
