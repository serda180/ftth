# Matriz de permisos

Los permisos se aplican en tres capas: la interfaz oculta lo que el rol no puede hacer, las funciones de base de datos validan el rol, y **Row Level Security** filtra cada fila en PostgreSQL. La capa que manda es la base de datos: aunque alguien manipule la interfaz, no puede leer ni escribir lo que su rol no permite.

- **L** = leer · **C** = crear · **E** = editar · **B** = eliminar · — = sin acceso
- El **administrador** tiene acceso completo a todo (no se repite en la tabla).
- Un usuario **desactivado** o **sin roles** no accede a nada.
- Un usuario puede tener varios roles; los permisos se suman.

| Entidad | Supervisor de red | Técnico | Atención al cliente | Inventario |
|---|---|---|---|---|
| Su propio perfil (nombre, teléfono) | L E | L E | L E | L E |
| Perfiles de otros usuarios | L | — | L | L |
| Roles de usuario | L | solo los propios | L | L |
| Activar/desactivar usuarios, asignar roles | — | — | — | — |
| Comunas, configuración, planes | L | L | L | L |
| Tipos de elemento, modelos de cable, ratios | L C E B | L | L | L |
| Elementos de red, cables, conexiones, zonas | L C E B | L | L | L |
| Puertos de NAP e hilos (estado) | L E | L | L | L |
| Clientes | L | L, solo los de sus órdenes | L C E | — |
| Historial del cliente | L, notas | L y notas, solo de sus clientes | L, notas | — |
| Solicitudes de instalación | L C E | — | L C E | — |
| Órdenes de trabajo | L C E | L E, solo las propias (*) | L C E | — |
| Bodegas | L | L | L | L C E |
| Proveedores | L | — | — | L C E |
| Artículos | L | L | L | L C E (**) |
| Stock | L | L, solo su bodega | — | L |
| Equipos serializados | L | L, solo su bodega | L | L C E |
| Movimientos de inventario | L | L de su bodega; C solo consumo en sus órdenes | — | L C |
| Ajuste de costo de artículos | — | — | — | — |
| Auditoría | — | — | — | — |
| Mapa: ver elementos, cables, fichas, buscar, medir | sí | sí | sí | sí |
| Mapa: crear, editar, mover y eliminar elementos y cables | sí | no | no | no |
| Asignar, cambiar o liberar el puerto de un cliente | sí | no | sí | no |
| Registrar, verificar o quitar conexiones (alimentación de NAP, inyección PON, empalmes) | sí | no | no | no |
| Ver rutas, topología e impacto | sí | sí (solo clientes de sus órdenes) | sí | sí (sin datos de clientes) |
| Planes y parámetros de la empresa | solo lectura | solo lectura | solo lectura | solo lectura |
| Indicadores del panel | sí | no (tiene su vista "Mis órdenes") | sí | sí |

(*) El técnico solo puede cambiar el estado a *en camino*, *en ejecución* o *completada*, y registrar potencia, resultado de pruebas, conformidad y observaciones. No puede reasignar, reprogramar, cambiar prioridad ni cancelar.

(**) El costo de un artículo no se edita a mano: lo fijan las compras (costo más alto) o un ajuste del administrador con motivo.

Eliminar clientes, solicitudes y órdenes es exclusivo del administrador; en el uso normal se marca `eliminado_en` (borrado lógico).

## Cómo se implementa

- `public.tiene_rol(roles...)`: verdadero si el usuario está activo y tiene alguno de los roles (el administrador siempre cumple). Es `security definer` y lee la tabla `usuario_roles`, no los metadatos del usuario.
- Cada tabla tiene RLS activado y políticas por operación (ver `supabase/migrations/20261020000009_seguridad_rls.sql`).
- El rol `anon` (sin sesión) no tiene privilegios sobre ninguna tabla ni función.
- Las pruebas de `supabase/tests/database/02_usuarios_roles.test.sql` y `04_rls_roles.test.sql` comprueban esta matriz.
