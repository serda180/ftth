-- =====================================================================
-- 0009 · Seguridad: privilegios y Row Level Security
-- =====================================================================
-- Matriz completa en docs/permisos.md. Reglas generales:
--  · anon (sin sesión) no accede a ninguna tabla.
--  · Todo usuario debe estar activo y tener al menos un rol.
--  · El administrador cumple cualquier condición de rol (ver tiene_rol).
--  · Las llamadas a funciones van envueltas en (select ...) para que
--    PostgreSQL las evalúe una sola vez por consulta.

-- ---------------------------------------------------------------------
-- Privilegios base
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Funciones: PostgreSQL concede EXECUTE a PUBLIC por defecto (y anon es
-- miembro de PUBLIC). Se retira y se concede solo a usuarios autenticados.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
revoke execute on function public.siguiente_correlativo(text) from authenticated;

-- Las funciones internas de disparadores no se exponen como RPC.
revoke execute on function
  public.tg_normalizar_rut(), public.tg_actualizado_en(), public.tg_crear_perfil(),
  public.tg_sincronizar_email(), public.tg_proteger_ultimo_admin(),
  public.tg_proteger_campos_perfil(), public.tg_normalizar_telefono_perfil(),
  public.tg_nap_sincronizar_puertos(), public.tg_cable_sincronizar_hilos(),
  public.tg_conexion_validar_elemento(), public.tg_normalizar_contacto(),
  public.tg_cliente_historial(), public.tg_solicitud_numero(), public.tg_orden_preparar(),
  public.tg_orden_guardia_tecnico(), public.tg_articulos_proteger_costo(),
  public.tg_movimiento_aplicar(), public.tg_movimiento_inmutable(), public.tg_auditar(),
  public.tg_crear_bodega_tecnico()
from public, authenticated;

-- ---------------------------------------------------------------------
-- Funciones auxiliares de autorización
-- ---------------------------------------------------------------------

-- Bodega del técnico que consulta (null si no tiene).
create or replace function public.mi_bodega_id()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.bodegas where tecnico_id = (select auth.uid()) and activo;
$$;

-- Verdadero si el cliente tiene una orden vigente asignada al técnico actual.
create or replace function public.tecnico_tiene_cliente(p_cliente_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ordenes_trabajo o
    where o.cliente_id = p_cliente_id
      and o.tecnico_id = (select auth.uid())
      and o.estado <> 'cancelada'
      and o.eliminado_en is null
  ) and public.es_usuario_activo();
$$;

-- Verdadero si la orden está asignada al técnico actual.
create or replace function public.es_mi_orden(p_orden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ordenes_trabajo o
    where o.id = p_orden_id and o.tecnico_id = (select auth.uid()) and o.eliminado_en is null
  ) and public.es_usuario_activo();
$$;

revoke all on function public.mi_bodega_id(), public.tecnico_tiene_cliente(uuid),
  public.es_mi_orden(uuid) from public, anon;
grant execute on function public.mi_bodega_id(), public.tecnico_tiene_cliente(uuid),
  public.es_mi_orden(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Activar RLS en todas las tablas del esquema public
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Usuarios
-- ---------------------------------------------------------------------
create policy perfiles_select on public.perfiles for select to authenticated
  using (id = (select auth.uid())
         or (select public.tiene_rol('supervisor_red', 'atencion_cliente', 'inventario')));
create policy perfiles_update on public.perfiles for update to authenticated
  using (id = (select auth.uid()) or (select public.es_admin()))
  with check (id = (select auth.uid()) or (select public.es_admin()));

create policy usuario_roles_select on public.usuario_roles for select to authenticated
  using (usuario_id = (select auth.uid())
         or (select public.tiene_rol('supervisor_red', 'atencion_cliente', 'inventario')));
create policy usuario_roles_insert on public.usuario_roles for insert to authenticated
  with check ((select public.es_admin()));
create policy usuario_roles_delete on public.usuario_roles for delete to authenticated
  using ((select public.es_admin()));

-- ---------------------------------------------------------------------
-- Catálogos: lectura para todo usuario activo
-- ---------------------------------------------------------------------
create policy regiones_select on public.regiones for select to authenticated
  using ((select public.es_usuario_activo()));

do $$
declare
  t text;
  escritura text;
begin
  for t, escritura in
    select * from (values
      ('comunas',         'public.es_admin()'),
      ('configuracion',   'public.es_admin()'),
      ('planes',          'public.es_admin()'),
      ('tipos_elemento',  'public.tiene_rol(''supervisor_red'')'),
      ('modelos_cable',   'public.tiene_rol(''supervisor_red'')'),
      ('ratios_splitter', 'public.tiene_rol(''supervisor_red'')')
    ) v(tabla, cond)
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                      using ((select public.es_usuario_activo()))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                      with check ((select %2$s))', t, escritura);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                      using ((select %2$s)) with check ((select %2$s))', t, escritura);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                      using ((select %2$s))', t, escritura);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Infraestructura: lectura para todo usuario activo (los técnicos usan
-- el mapa en terreno); escritura para supervisor de red.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'elementos_red', 'olts', 'olt_puertos_pon', 'nap', 'postes', 'camaras', 'cajas_empalme',
    'splitters', 'gabinetes', 'puntos_ingreso', 'cables', 'cable_soportes', 'conexiones',
    'zonas_cobertura'
  ] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                      using ((select public.es_usuario_activo()))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                      with check ((select public.tiene_rol(''supervisor_red'')))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                      using ((select public.tiene_rol(''supervisor_red'')))
                      with check ((select public.tiene_rol(''supervisor_red'')))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                      using ((select public.tiene_rol(''supervisor_red'')))', t);
  end loop;
end;
$$;

-- Puertos e hilos: se crean y eliminan solos; el supervisor puede cambiar
-- su estado (ej.: marcar averiado). La reserva y asignación a clientes se
-- hará mediante funciones transaccionales (Etapa 3).
create policy nap_puertos_select on public.nap_puertos for select to authenticated
  using ((select public.es_usuario_activo()));
create policy nap_puertos_update on public.nap_puertos for update to authenticated
  using ((select public.tiene_rol('supervisor_red')))
  with check ((select public.tiene_rol('supervisor_red')));

create policy cable_hilos_select on public.cable_hilos for select to authenticated
  using ((select public.es_usuario_activo()));
create policy cable_hilos_update on public.cable_hilos for update to authenticated
  using ((select public.tiene_rol('supervisor_red')))
  with check ((select public.tiene_rol('supervisor_red')));

-- ---------------------------------------------------------------------
-- Clientes y solicitudes
-- ---------------------------------------------------------------------
create policy clientes_select on public.clientes for select to authenticated
  using ((select public.tiene_rol('supervisor_red', 'atencion_cliente'))
         or public.tecnico_tiene_cliente(id));
create policy clientes_insert on public.clientes for insert to authenticated
  with check ((select public.tiene_rol('atencion_cliente')));
create policy clientes_update on public.clientes for update to authenticated
  using ((select public.tiene_rol('atencion_cliente')))
  with check ((select public.tiene_rol('atencion_cliente')));
create policy clientes_delete on public.clientes for delete to authenticated
  using ((select public.es_admin()));

create policy cliente_historial_select on public.cliente_historial for select to authenticated
  using ((select public.tiene_rol('supervisor_red', 'atencion_cliente'))
         or public.tecnico_tiene_cliente(cliente_id));
create policy cliente_historial_insert on public.cliente_historial for insert to authenticated
  with check (tipo in ('nota', 'visita')
              and creado_por = (select auth.uid())
              and ((select public.tiene_rol('supervisor_red', 'atencion_cliente'))
                   or public.tecnico_tiene_cliente(cliente_id)));

create policy solicitudes_select on public.solicitudes for select to authenticated
  using ((select public.tiene_rol('supervisor_red', 'atencion_cliente')));
create policy solicitudes_insert on public.solicitudes for insert to authenticated
  with check ((select public.tiene_rol('supervisor_red', 'atencion_cliente')));
create policy solicitudes_update on public.solicitudes for update to authenticated
  using ((select public.tiene_rol('supervisor_red', 'atencion_cliente')))
  with check ((select public.tiene_rol('supervisor_red', 'atencion_cliente')));
create policy solicitudes_delete on public.solicitudes for delete to authenticated
  using ((select public.es_admin()));

-- ---------------------------------------------------------------------
-- Órdenes de trabajo
-- ---------------------------------------------------------------------
create policy ordenes_select on public.ordenes_trabajo for select to authenticated
  using ((select public.tiene_rol('supervisor_red', 'atencion_cliente'))
         or (tecnico_id = (select auth.uid()) and (select public.es_usuario_activo())));
create policy ordenes_insert on public.ordenes_trabajo for insert to authenticated
  with check ((select public.tiene_rol('supervisor_red', 'atencion_cliente')));
create policy ordenes_update on public.ordenes_trabajo for update to authenticated
  using ((select public.tiene_rol('supervisor_red', 'atencion_cliente'))
         or (tecnico_id = (select auth.uid()) and (select public.es_usuario_activo())))
  with check ((select public.tiene_rol('supervisor_red', 'atencion_cliente'))
              or (tecnico_id = (select auth.uid()) and (select public.es_usuario_activo())));
create policy ordenes_delete on public.ordenes_trabajo for delete to authenticated
  using ((select public.es_admin()));

-- ---------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------
create policy bodegas_select on public.bodegas for select to authenticated
  using ((select public.es_usuario_activo()));
create policy bodegas_insert on public.bodegas for insert to authenticated
  with check ((select public.tiene_rol('inventario')));
create policy bodegas_update on public.bodegas for update to authenticated
  using ((select public.tiene_rol('inventario'))) with check ((select public.tiene_rol('inventario')));

create policy proveedores_select on public.proveedores for select to authenticated
  using ((select public.tiene_rol('inventario', 'supervisor_red')));
create policy proveedores_insert on public.proveedores for insert to authenticated
  with check ((select public.tiene_rol('inventario')));
create policy proveedores_update on public.proveedores for update to authenticated
  using ((select public.tiene_rol('inventario'))) with check ((select public.tiene_rol('inventario')));

create policy articulos_select on public.articulos for select to authenticated
  using ((select public.es_usuario_activo()));
create policy articulos_insert on public.articulos for insert to authenticated
  with check ((select public.tiene_rol('inventario')));
create policy articulos_update on public.articulos for update to authenticated
  using ((select public.tiene_rol('inventario'))) with check ((select public.tiene_rol('inventario')));

create policy articulo_costo_ajustes_select on public.articulo_costo_ajustes for select to authenticated
  using ((select public.tiene_rol('inventario')));

create policy stock_select on public.stock for select to authenticated
  using ((select public.tiene_rol('inventario', 'supervisor_red'))
         or bodega_id = (select public.mi_bodega_id()));

create policy equipos_select on public.equipos for select to authenticated
  using ((select public.tiene_rol('inventario', 'supervisor_red', 'atencion_cliente'))
         or bodega_id = (select public.mi_bodega_id()));
create policy equipos_insert on public.equipos for insert to authenticated
  with check ((select public.tiene_rol('inventario')));
create policy equipos_update on public.equipos for update to authenticated
  using ((select public.tiene_rol('inventario'))) with check ((select public.tiene_rol('inventario')));

create policy movimientos_select on public.movimientos_inventario for select to authenticated
  using ((select public.tiene_rol('inventario', 'supervisor_red'))
         or bodega_origen_id = (select public.mi_bodega_id())
         or bodega_destino_id = (select public.mi_bodega_id()));
-- Inventario registra cualquier movimiento; un técnico solo registra el
-- consumo de material de su propia bodega en una orden que le pertenece.
create policy movimientos_insert on public.movimientos_inventario for insert to authenticated
  with check ((select public.tiene_rol('inventario'))
              or (tipo = 'consumo_ot'
                  and bodega_origen_id = (select public.mi_bodega_id())
                  and public.es_mi_orden(orden_id)));

-- ---------------------------------------------------------------------
-- Auditoría: solo lectura para administradores
-- ---------------------------------------------------------------------
create policy auditoria_select on public.auditoria for select to authenticated
  using ((select public.es_admin()));
revoke insert, update, delete, truncate on public.auditoria from authenticated;
revoke insert, update, delete, truncate on public.movimientos_inventario from authenticated;
grant insert on public.movimientos_inventario to authenticated;
