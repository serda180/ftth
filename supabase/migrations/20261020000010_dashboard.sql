-- =====================================================================
-- 0010 · Indicadores del panel y limpieza de datos de demostración
-- =====================================================================

-- Indicadores calculados en la base (no en el navegador). Devuelve solo
-- agregados; requiere un rol de gestión (no técnico puro).
create or replace function public.dashboard_indicadores()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz constant text := 'America/Santiago';
  v_inicio_mes timestamptz := date_trunc('month', now() at time zone v_tz) at time zone v_tz;
  v_mes_actual date := date_trunc('month', now() at time zone v_tz)::date;
  v_alerta numeric := coalesce((select (valor #>> '{}')::numeric from public.configuracion
                                where clave = 'ocupacion_alerta_pct'), 80);
  r jsonb;
begin
  if not public.tiene_rol('supervisor_red', 'atencion_cliente', 'inventario') then
    raise exception 'No tiene permiso para ver los indicadores' using errcode = '42501';
  end if;

  with
  cli as (
    select
      count(*) filter (where estado <> 'retirado')  as vigentes,
      count(*) filter (where estado = 'activo')     as activos,
      count(*) filter (where estado = 'suspendido') as suspendidos,
      count(*) filter (where estado = 'pendiente')  as pendientes,
      coalesce(sum(coalesce(c.precio_mensual_clp, p.precio_clp)) filter (where estado = 'activo'), 0) as ingreso
    from public.clientes c
    left join public.planes p on p.id = c.plan_id
    where c.eliminado_en is null
  ),
  retirados_mes as (
    select count(distinct h.cliente_id) as n
    from public.cliente_historial h
    where h.tipo = 'cambio_estado' and h.datos ->> 'nuevo' = 'retirado' and h.creado_en >= v_inicio_mes
  ),
  sol as (
    select
      count(*) filter (where estado in ('nueva', 'en_factibilidad', 'pendiente_info', 'factible',
                                        'puerto_reservado', 'orden_generada', 'instalada')) as pendientes,
      count(*) filter (where estado = 'en_factibilidad') as en_factibilidad
    from public.solicitudes where eliminado_en is null
  ),
  ot as (
    select
      count(*) filter (where estado in ('pendiente', 'asignada', 'en_camino', 'en_ejecucion')) as abiertas,
      count(*) filter (where tipo = 'instalacion' and estado = 'completada'
                         and cerrada_en >= v_inicio_mes) as instalaciones_mes
    from public.ordenes_trabajo where eliminado_en is null
  ),
  naps as (
    select n.elemento_id, n.capacidad_puertos
    from public.nap n
    join public.elementos_red e on e.id = n.elemento_id
    where e.eliminado_en is null and e.estado <> 'retirado'
  ),
  puertos as (
    select
      count(*) as total,
      count(*) filter (where p.estado = 'libre')     as libres,
      count(*) filter (where p.estado = 'reservado') as reservados,
      count(*) filter (where p.estado = 'ocupado')   as ocupados,
      count(*) filter (where p.estado = 'averiado')  as averiados
    from public.nap_puertos p
    join naps n on n.elemento_id = p.nap_id
  ),
  nap_alerta as (
    select count(*) as n
    from naps n
    where (select count(*) from public.nap_puertos p
           where p.nap_id = n.elemento_id and p.estado in ('ocupado', 'reservado')) * 100.0
          / n.capacidad_puertos >= v_alerta
  ),
  km as (
    select coalesce(jsonb_object_agg(tipo, km), '{}'::jsonb) as por_tipo
    from (
      select tipo::text, round(sum(coalesce(longitud_declarada_m, longitud_mapa_m)) / 1000.0, 2) as km
      from public.cables
      where eliminado_en is null and estado <> 'retirado'
      group by tipo
    ) x
  ),
  stock_bajo as (
    select count(*) as n
    from public.articulos a
    where a.activo and a.stock_minimo > 0
      and coalesce((select sum(s.cantidad) from public.stock s where s.articulo_id = a.id), 0) < a.stock_minimo
  ),
  meses as (
    select (v_mes_actual - make_interval(months => g))::date as mes
    from generate_series(11, 0, -1) g
  ),
  serie as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', to_char(m.mes, 'YYYY-MM'),
      'altas', (select count(*) from public.clientes c
                where c.eliminado_en is null
                  and c.fecha_contratacion >= m.mes
                  and c.fecha_contratacion < (m.mes + interval '1 month')::date),
      'instalaciones', (select count(*) from public.ordenes_trabajo o
                        where o.eliminado_en is null and o.tipo = 'instalacion' and o.estado = 'completada'
                          and (o.cerrada_en at time zone v_tz)::date >= m.mes
                          and (o.cerrada_en at time zone v_tz)::date < (m.mes + interval '1 month')::date)
    ) order by m.mes), '[]'::jsonb) as datos
    from meses m
  )
  select jsonb_build_object(
    'generado_en', now(),
    'clientes', jsonb_build_object(
      'vigentes', cli.vigentes, 'activos', cli.activos, 'suspendidos', cli.suspendidos,
      'pendientes', cli.pendientes, 'retirados_mes', retirados_mes.n),
    'ingreso_mensual_clp', cli.ingreso,
    'solicitudes', jsonb_build_object('pendientes', sol.pendientes, 'en_factibilidad', sol.en_factibilidad),
    'ordenes', jsonb_build_object('abiertas', ot.abiertas, 'instalaciones_mes', ot.instalaciones_mes),
    'nap', jsonb_build_object(
      'total', (select count(*) from naps),
      'sobre_alerta', nap_alerta.n,
      'umbral_alerta_pct', v_alerta),
    'puertos', jsonb_build_object(
      'total', puertos.total, 'libres', puertos.libres, 'reservados', puertos.reservados,
      'ocupados', puertos.ocupados, 'averiados', puertos.averiados,
      'ocupacion_pct', case when puertos.total = 0 then 0
                            else round((puertos.ocupados + puertos.reservados) * 100.0 / puertos.total, 1) end),
    'km_cable', km.por_tipo,
    'materiales_stock_bajo', stock_bajo.n,
    'serie_mensual', serie.datos
  ) into r
  from cli, retirados_mes, sol, ot, puertos, nap_alerta, km, stock_bajo, serie;

  return r;
end;
$$;
revoke all on function public.dashboard_indicadores() from public, anon;
grant execute on function public.dashboard_indicadores() to authenticated;

-- Elimina todos los registros marcados como demostración (es_demo = true).
-- Solo administrador. Devuelve cuántas filas se eliminaron por tabla.
create or replace function public.eliminar_datos_demo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := '{}'::jsonb;
  n int;
begin
  if (select auth.uid()) is not null and not public.es_admin() then
    raise exception 'Solo un administrador puede eliminar los datos de demostración' using errcode = '42501';
  end if;
  perform set_config('app.eliminando_demo', 'on', true);

  delete from public.movimientos_inventario where es_demo;            get diagnostics n = row_count; r := r || jsonb_build_object('movimientos_inventario', n);
  delete from public.stock s using public.articulos a
    where a.id = s.articulo_id and a.es_demo;                          get diagnostics n = row_count; r := r || jsonb_build_object('stock', n);
  delete from public.equipos where es_demo;                           get diagnostics n = row_count; r := r || jsonb_build_object('equipos', n);
  delete from public.articulos where es_demo;                         get diagnostics n = row_count; r := r || jsonb_build_object('articulos', n);
  delete from public.proveedores where es_demo;                       get diagnostics n = row_count; r := r || jsonb_build_object('proveedores', n);
  delete from public.ordenes_trabajo where es_demo;                   get diagnostics n = row_count; r := r || jsonb_build_object('ordenes_trabajo', n);
  delete from public.solicitudes where es_demo;                       get diagnostics n = row_count; r := r || jsonb_build_object('solicitudes', n);
  delete from public.clientes where es_demo;                          get diagnostics n = row_count; r := r || jsonb_build_object('clientes', n);
  delete from public.conexiones where es_demo;                        get diagnostics n = row_count; r := r || jsonb_build_object('conexiones', n);
  delete from public.cable_soportes cs using public.cables c
    where c.id = cs.cable_id and c.es_demo;
  delete from public.cables where es_demo;                            get diagnostics n = row_count; r := r || jsonb_build_object('cables', n);
  delete from public.elementos_red where es_demo;                     get diagnostics n = row_count; r := r || jsonb_build_object('elementos_red', n);
  delete from public.zonas_cobertura where es_demo;                   get diagnostics n = row_count; r := r || jsonb_build_object('zonas_cobertura', n);
  delete from public.planes where es_demo;                            get diagnostics n = row_count; r := r || jsonb_build_object('planes', n);

  perform set_config('app.eliminando_demo', 'off', true);
  return r;
end;
$$;
revoke all on function public.eliminar_datos_demo() from public, anon;
grant execute on function public.eliminar_datos_demo() to authenticated;
