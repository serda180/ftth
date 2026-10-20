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
| 17 | El mapa no usa Leaflet-Geoman ni Leaflet.markercluster: el dibujo, la edición de vértices y la medición son herramientas propias, y la agrupación se hace en el servidor. | Control total del flujo en teléfonos (botones grandes de *Terminar* y *Deshacer*), menos dependencias, y el servidor solo envía grupos cuando hay muchos elementos en pantalla, lo que escala mejor que agrupar miles de marcadores en el navegador. |
| 18 | El mapa carga solo la zona visible (`mapa_elementos`, `mapa_cables`, `mapa_zonas`) y bajo el zoom 16 agrupa si hay más de 600 elementos. | Rendimiento con redes grandes. Umbrales editables en `configuracion`. |
| 19 | Al guardar un cable con origen o destino, el servidor ubica el extremo del trazado exactamente sobre el elemento; al mover un elemento, los extremos de sus cables lo siguen. | Que el vínculo origen/destino sea real y no solo una cercanía visual. |
| 20 | Los puertos de NAP solo pasan entre *libre* y *averiado* a mano; *ocupado* y *reservado* los asignarán las funciones de clientes e instalaciones. | Evita que alguien ocupe o libere un puerto sin pasar por el flujo que lo justifica. |
| 21 | Las bajas desde el mapa son lógicas y se bloquean si hay dependencias (puertos ocupados, conexiones, cables que nacen, terminan o pasan por el elemento). | Integridad de la red registrada. |
| 22 | Capa base OpenStreetMap y satelital Esri configurables en `configuracion` (`mapa_teselas`, `mapa_satelite`). **(revisar)** | La política de uso de las teselas públicas de OSM no admite uso intensivo; para producción con muchos usuarios conviene un proveedor propio o contratado. |
| 23 | La asignación de puertos usa `SELECT ... FOR UPDATE` sobre el puerto dentro de una función, más el índice único de cliente vigente por puerto. La prueba de concurrencia es un script aparte (`supabase/tests/concurrencia/`) porque pgTAP corre en una sola sesión. | Garantiza que dos personas no asignen el mismo puerto aunque lo hagan en el mismo instante. |
| 24 | El camino de una NAP hasta la OLT se recorre con un bucle que sigue las conexiones hacia atrás (hilo → empalme/splitter → hilo → PON) en vez de un `WITH RECURSIVE`. | El recorrido alterna entre tipos de conexión distintos; el bucle lo expresa con claridad, detecta ciclos y dice exactamente qué falta cuando la ruta está incompleta. |
| 25 | La topología se dibuja como árbol OLT → PON → NAP con HTML propio, sin React Flow ni Cytoscape. | La red de un solo nivel de splitteo es un árbol; un árbol en HTML es legible en el teléfono y no agrega dependencias. Si la red crece en niveles, se puede cambiar a un grafo. |
| 26 | Los CSV se exportan con punto y coma y UTF-8 con BOM. | Excel en configuración regional de Chile usa punto y coma y necesita el BOM para mostrar bien tildes y ñ. |
| 27 | Planes y parámetros los edita solo el administrador (página Configuración). | Afectan precios y reglas técnicas de toda la empresa. |
| 28 | El presupuesto óptico estimado usa el largo completo de cada cable del camino (no el punto exacto de la sangría), la acometida como distancia × 1,3, la pérdida del splitter, 4 conectores y los empalmes. **(revisar)** | Es una cota conservadora con los datos que se registran. Atenuación y factores son editables en `configuracion`. |
| 29 | El cliente se crea al cerrar con éxito la orden de instalación, no al registrar la solicitud. | Así la base de clientes solo tiene servicios instalados; la solicitud guarda los datos mientras tanto. Si la solicitud ya tenía cliente (cambio de domicilio), se actualiza ese cliente. |
| 30 | Las reservas solo vencen mientras no hay orden de instalación; con orden, la reserva se mantiene hasta cerrarla o cancelarla. | Evita que un puerto se libere mientras el técnico va en camino. |
| 31 | Las fotos se comprimen en el teléfono (lado mayor 1600 px, JPEG 80 %) y se guardan en un bucket privado; se ven con URL firmadas de 10 minutos. | Menos datos móviles en terreno y datos personales protegidos. |
| 32 | La app del técnico es una PWA instalable sin modo sin conexión. | El requerimiento permitía dejarlo para después; sincronizar sin conexión agrega conflictos que conviene diseñar con el uso real. |
