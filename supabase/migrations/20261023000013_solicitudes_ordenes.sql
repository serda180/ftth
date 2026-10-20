-- =====================================================================
-- 0013 · Solicitudes, factibilidad, órdenes de trabajo y fotos (Etapa 4)
-- =====================================================================

insert into public.configuracion (clave, valor, descripcion) values
  ('atenuacion_db_km', '0.35'::jsonb, 'Atenuación de la fibra para estimar el presupuesto óptico, en dB/km'),
  ('factor_acometida', '1.3'::jsonb, 'Factor para estimar el largo de la acometida a partir de la distancia en línea recta')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- Técnicos: ven la solicitud de una orden que tienen asignada
-- ---------------------------------------------------------------------
create or replace function public.tecnico_tiene_solicitud(p_solicitud_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ordenes_trabajo o
    where o.solicitud_id = p_solicitud_id and o.tecnico_id = (select auth.uid())
      and o.estado <> 'cancelada' and o.eliminado_en is null
  ) and public.es_usuario_activo();
$$;

drop policy solicitudes_select on public.solicitudes;
create policy solicitudes_select on public.solicitudes for select to authenticated
  using ((select public.tiene_rol('supervisor_red', 'atencion_cliente'))
         or public.tecnico_tiene_solicitud(id));

-- Puede ver (y adjuntar fotos a) una orden: gestión o el técnico asignado.
create or replace function public.puede_ver_orden(p_orden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tiene_rol('supervisor_red', 'atencion_cliente') or public.es_mi_orden(p_orden_id);
$$;

-- La guardia de órdenes del técnico no aplica dentro de las funciones del
-- sistema (cerrar_orden, cancelar_solicitud), que corren como dueño de la base.
create or replace function public.tg_orden_guardia_tecnico()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  editables text[] := array[
    'estado', 'potencia_ont_dbm', 'potencia_nap_dbm', 'resultado_pruebas',
    'conformidad_cliente', 'observaciones', 'iniciada_en', 'cerrada_en',
    'ubicacion_cierre', 'actualizado_en'
  ];
begin
  if current_user not in ('authenticated', 'anon')
     or (select auth.uid()) is null
     or public.tiene_rol('supervisor_red', 'atencion_cliente') then
    return new;
  end if;

  if (to_jsonb(new) - editables) is distinct from (to_jsonb(old) - editables) then
    raise exception 'Como técnico solo puede actualizar el estado y el resultado del trabajo'
      using errcode = '42501';
  end if;

  if new.estado is distinct from old.estado then
    if old.estado in ('completada', 'cancelada') then
      raise exception 'La orden ya está cerrada' using errcode = '42501';
    end if;
    if new.estado not in ('en_camino', 'en_ejecucion', 'completada') then
      raise exception 'Como técnico no puede cambiar la orden al estado %', new.estado
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Factibilidad
-- ---------------------------------------------------------------------

-- Analiza las NAP cercanas a la solicitud y devuelve una recomendación.
-- Es una RECOMENDACIÓN basada en los datos registrados, no una garantía.
create or replace function public.evaluar_factibilidad(p_solicitud_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  s public.solicitudes%rowtype;
  v_max numeric := public.conf_numero('distancia_max_acometida_m', 250);
  v_presupuesto numeric := public.conf_numero('presupuesto_optico_db', 28);
  v_db_km numeric := public.conf_numero('atenuacion_db_km', 0.35);
  v_conector numeric := public.conf_numero('perdida_conector_db', 0.5);
  v_empalme numeric := public.conf_numero('perdida_empalme_db', 0.1);
  v_factor numeric := public.conf_numero('factor_acometida', 1.3);
  v_hay_zonas boolean;
  v_en_zona boolean;
  v_naps jsonb := '[]'::jsonb;
  n record;
  v_camino jsonb;
  v_km_red numeric;
  v_splitters numeric;
  v_empalmes int;
  v_total numeric;
  v_adv jsonb;
begin
  select * into s from public.solicitudes where id = p_solicitud_id and eliminado_en is null;
  if s.id is null then
    raise exception 'La solicitud no existe' using errcode = 'P0002';
  end if;
  if s.ubicacion is null then
    raise exception 'La solicitud no tiene ubicación; márquela en el mapa' using errcode = 'P0001';
  end if;

  select exists (select 1 from public.zonas_cobertura where eliminado_en is null and estado <> 'retirado') into v_hay_zonas;
  select exists (select 1 from public.zonas_cobertura where eliminado_en is null and estado <> 'retirado'
                 and st_intersects(area, s.ubicacion)) into v_en_zona;

  for n in
    select e.id, e.codigo, e.estado, st_distance(e.ubicacion, s.ubicacion) as distancia,
           nap.capacidad_puertos, rs.ratio, rs.perdida_db,
           (select count(*) from public.nap_puertos p where p.nap_id = e.id and p.estado = 'libre') as libres
    from public.elementos_red e
    join public.nap nap on nap.elemento_id = e.id
    join public.ratios_splitter rs on rs.id = nap.ratio_splitter_id
    where e.eliminado_en is null and e.estado <> 'retirado'
      and st_dwithin(e.ubicacion, s.ubicacion, greatest(v_max * 2, 300))
    order by st_distance(e.ubicacion, s.ubicacion)
    limit 8
  loop
    v_camino := public.camino_nap(n.id);
    v_adv := '[]'::jsonb;

    -- Fibra de la red: largo de cada cable del camino (cota conservadora, la
    -- sangría puede estar antes del final del cable) + acometida estimada.
    select coalesce(sum(coalesce(c.longitud_declarada_m, c.longitud_mapa_m)), 0) / 1000.0 into v_km_red
    from (select distinct (x ->> 'cable_id')::uuid as id from jsonb_array_elements(v_camino -> 'pasos') x
          where x ->> 'tipo' = 'hilo') cc
    join public.cables c on c.id = cc.id;
    select coalesce(sum(rs2.perdida_db), 0) into v_splitters
    from jsonb_array_elements(v_camino -> 'pasos') x
    join public.splitters sp on sp.elemento_id = (x ->> 'elemento_id')::uuid
    join public.ratios_splitter rs2 on rs2.id = sp.ratio_splitter_id
    where x ->> 'tipo' = 'splitter';
    select count(*) into v_empalmes from jsonb_array_elements(v_camino -> 'pasos') x where x ->> 'tipo' in ('hilo', 'empalme');

    v_total := round(((v_km_red + n.distancia::numeric * v_factor / 1000.0) * v_db_km
                      + n.perdida_db + v_splitters
                      + 4 * v_conector            -- OLT, NAP, roseta y ONT
                      + (v_empalmes + 2) * v_empalme)::numeric, 2);

    if n.libres = 0 then v_adv := v_adv || to_jsonb('La NAP está llena'::text); end if;
    if not coalesce((v_camino ->> 'completo')::boolean, false) then
      v_adv := v_adv || to_jsonb(coalesce(v_camino ->> 'faltante', 'Sin ruta registrada a la OLT'));
    end if;
    if n.distancia > v_max then
      v_adv := v_adv || to_jsonb(format('La distancia (%s m) supera el máximo de acometida (%s m)', round(n.distancia::numeric), v_max));
    end if;
    if n.estado <> 'operativo' then
      v_adv := v_adv || to_jsonb(format('La NAP está en estado %s', replace(n.estado::text, '_', ' ')));
    end if;
    if (v_camino ->> 'completo')::boolean and v_total > v_presupuesto then
      v_adv := v_adv || to_jsonb(format('La pérdida estimada (%s dB) supera el presupuesto óptico (%s dB)', v_total, v_presupuesto));
    end if;

    v_naps := v_naps || jsonb_build_object(
      'id', n.id, 'codigo', n.codigo, 'estado', n.estado, 'distancia_m', round(n.distancia::numeric, 1),
      'capacidad', n.capacidad_puertos, 'libres', n.libres, 'ratio', n.ratio,
      'ruta_completa', coalesce((v_camino ->> 'completo')::boolean, false),
      'perdida_estimada_db', v_total,
      'margen_db', round(v_presupuesto - v_total, 2),
      'advertencias', v_adv,
      'apta', jsonb_array_length(v_adv) = 0);
  end loop;

  return jsonb_build_object(
    'recomendacion', case
      when jsonb_array_length(v_naps) = 0 then 'no_factible'
      when v_hay_zonas and not v_en_zona then 'revisar'
      when exists (select 1 from jsonb_array_elements(v_naps) x where (x ->> 'apta')::boolean) then 'factible'
      else 'revisar' end,
    'fuera_de_cobertura', v_hay_zonas and not v_en_zona,
    'naps', v_naps,
    'parametros', jsonb_build_object('distancia_max_m', v_max, 'presupuesto_db', v_presupuesto, 'atenuacion_db_km', v_db_km),
    'evaluado_en', now(),
    'aviso', 'Recomendación basada en los datos registrados; no garantiza que la instalación sea técnicamente posible.');
end;
$$;

-- Decisión del supervisor sobre la factibilidad.
create or replace function public.decidir_factibilidad(p_solicitud_id uuid, p_decision text, p_motivo text, p_nap_id uuid default null)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  s public.solicitudes%rowtype;
begin
  perform public.exigir_supervisor();
  if p_decision not in ('factible', 'no_factible', 'pendiente_info') then
    raise exception 'Decisión no válida' using errcode = '22023';
  end if;
  select * into s from public.solicitudes where id = p_solicitud_id and eliminado_en is null for update;
  if s.id is null then
    raise exception 'La solicitud no existe' using errcode = 'P0002';
  end if;
  if s.estado not in ('nueva', 'en_factibilidad', 'pendiente_info', 'factible', 'no_factible') then
    raise exception 'La solicitud ya avanzó (%); no se puede cambiar su factibilidad', s.estado using errcode = 'P0001';
  end if;
  if p_decision = 'factible' and p_nap_id is null then
    raise exception 'Indique la NAP con que se atenderá' using errcode = '23502';
  end if;
  if p_decision = 'no_factible' and nullif(btrim(p_motivo), '') is null then
    raise exception 'Indique el motivo del rechazo' using errcode = '23502';
  end if;

  update public.solicitudes set
    estado = p_decision::public.estado_solicitud,
    nap_id = case when p_decision = 'factible' then p_nap_id else null end,
    motivo_decision = nullif(btrim(p_motivo), ''),
    factibilidad = case when s.ubicacion is not null then public.evaluar_factibilidad(p_solicitud_id) end,
    evaluado_por = (select auth.uid()),
    evaluado_en = now()
  where id = p_solicitud_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Reserva de puerto (transaccional) y vencimiento
-- ---------------------------------------------------------------------
create or replace function public.reservar_puerto(p_solicitud_id uuid, p_puerto_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.solicitudes%rowtype;
  v_puerto record;
begin
  if not public.tiene_rol('atencion_cliente', 'supervisor_red') then
    raise exception 'No tiene permiso para reservar puertos' using errcode = '42501';
  end if;
  select * into s from public.solicitudes where id = p_solicitud_id and eliminado_en is null for update;
  if s.id is null then
    raise exception 'La solicitud no existe' using errcode = 'P0002';
  end if;
  if s.estado not in ('factible', 'puerto_reservado') then
    raise exception 'Solo se reserva puerto a una solicitud factible (estado actual: %)', s.estado using errcode = 'P0001';
  end if;

  select p.id, p.numero, p.estado, p.nap_id, e.codigo into v_puerto
  from public.nap_puertos p join public.elementos_red e on e.id = p.nap_id
  where p.id = p_puerto_id and e.eliminado_en is null
  for update of p;
  if v_puerto.id is null then
    raise exception 'El puerto no existe' using errcode = 'P0002';
  end if;
  if s.puerto_reservado_id = p_puerto_id then
    return;
  end if;
  if v_puerto.estado <> 'libre' then
    raise exception 'El puerto % de % no está libre (está %)', v_puerto.numero, v_puerto.codigo, v_puerto.estado
      using errcode = 'P0001';
  end if;

  if s.puerto_reservado_id is not null then
    update public.nap_puertos set estado = 'libre' where id = s.puerto_reservado_id and estado = 'reservado';
  end if;
  update public.nap_puertos set estado = 'reservado' where id = p_puerto_id;
  update public.solicitudes set
    estado = 'puerto_reservado',
    puerto_reservado_id = p_puerto_id,
    nap_id = v_puerto.nap_id,
    reserva_vence_en = now() + make_interval(hours => public.conf_numero('reserva_puerto_horas', 72)::int)
  where id = p_solicitud_id;
end;
$$;

-- Libera la reserva y deja la solicitud factible de nuevo.
create or replace function public.liberar_reserva(p_solicitud_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.solicitudes%rowtype;
begin
  if (select auth.uid()) is not null and not public.tiene_rol('atencion_cliente', 'supervisor_red') then
    raise exception 'No tiene permiso para liberar reservas' using errcode = '42501';
  end if;
  select * into s from public.solicitudes where id = p_solicitud_id for update;
  if s.puerto_reservado_id is null then
    return;
  end if;
  if s.estado = 'orden_generada' then
    raise exception 'La solicitud tiene una orden de instalación en curso; cancélela primero' using errcode = 'P0001';
  end if;
  update public.nap_puertos set estado = 'libre' where id = s.puerto_reservado_id and estado = 'reservado';
  update public.solicitudes set
    puerto_reservado_id = null, reserva_vence_en = null,
    estado = case when estado = 'puerto_reservado' then 'factible'::public.estado_solicitud else estado end
  where id = p_solicitud_id;
end;
$$;

-- Libera las reservas vencidas (la ejecuta pg_cron cada 15 minutos).
create or replace function public.liberar_reservas_vencidas()
returns int
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id from public.solicitudes
    where estado = 'puerto_reservado' and reserva_vence_en < now() and eliminado_en is null
    for update skip locked
  loop
    perform public.liberar_reserva(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('liberar-reservas-vencidas', '*/15 * * * *', 'select public.liberar_reservas_vencidas()');
exception when others then
  raise notice 'pg_cron no disponible (%): programe liberar_reservas_vencidas() por otro medio', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------
-- Órdenes
-- ---------------------------------------------------------------------

-- Crea la orden de instalación de una solicitud con puerto reservado.
create or replace function public.generar_orden_instalacion(
  p_solicitud_id uuid, p_tecnico_id uuid, p_fecha timestamptz,
  p_prioridad public.prioridad_orden default 'media', p_descripcion text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.solicitudes%rowtype;
  v_id uuid;
begin
  if not public.tiene_rol('atencion_cliente', 'supervisor_red') then
    raise exception 'No tiene permiso para crear órdenes' using errcode = '42501';
  end if;
  select * into s from public.solicitudes where id = p_solicitud_id and eliminado_en is null for update;
  if s.id is null then
    raise exception 'La solicitud no existe' using errcode = 'P0002';
  end if;
  if s.estado <> 'puerto_reservado' then
    raise exception 'Primero reserve un puerto para la solicitud (estado actual: %)', s.estado using errcode = 'P0001';
  end if;
  -- Datos que exigirá el alta del cliente al cerrar la orden.
  if s.rut is null then
    raise exception 'Complete el RUT del solicitante antes de generar la orden' using errcode = '23502';
  end if;
  if s.plan_id is null then
    raise exception 'Indique el plan contratado antes de generar la orden' using errcode = '23502';
  end if;
  if p_tecnico_id is not null and not exists (
    select 1 from public.usuario_roles ur join public.perfiles pf on pf.id = ur.usuario_id
    where ur.usuario_id = p_tecnico_id and ur.rol = 'tecnico' and pf.activo
  ) then
    raise exception 'El usuario elegido no es un técnico activo' using errcode = 'P0001';
  end if;

  insert into public.ordenes_trabajo (tipo, prioridad, estado, solicitud_id, cliente_id, direccion, comuna_id, ubicacion,
                                      tecnico_id, fecha_programada, descripcion)
  values ('instalacion', coalesce(p_prioridad, 'media'),
          case when p_tecnico_id is null then 'pendiente' else 'asignada' end::public.estado_orden,
          s.id, s.cliente_id,
          concat_ws(' ', s.direccion_calle, s.direccion_numero, s.direccion_depto), s.comuna_id, s.ubicacion,
          p_tecnico_id, p_fecha,
          coalesce(nullif(btrim(p_descripcion), ''), 'Instalación de servicio ' || s.numero))
  returning id into v_id;

  update public.solicitudes set estado = 'orden_generada', reserva_vence_en = null where id = s.id;
  return v_id;
end;
$$;

-- Asigna (o reasigna) técnico y fecha a una orden.
create or replace function public.asignar_orden(p_orden_id uuid, p_tecnico_id uuid, p_fecha timestamptz)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.tiene_rol('supervisor_red', 'atencion_cliente') then
    raise exception 'No tiene permiso para asignar órdenes' using errcode = '42501';
  end if;
  if p_tecnico_id is not null and not exists (
    select 1 from public.usuario_roles ur join public.perfiles pf on pf.id = ur.usuario_id
    where ur.usuario_id = p_tecnico_id and ur.rol = 'tecnico' and pf.activo
  ) then
    raise exception 'El usuario elegido no es un técnico activo' using errcode = 'P0001';
  end if;
  update public.ordenes_trabajo set
    tecnico_id = p_tecnico_id,
    fecha_programada = p_fecha,
    estado = case
      when estado in ('completada', 'cancelada') then estado
      when p_tecnico_id is null then 'pendiente'::public.estado_orden
      when estado = 'pendiente' then 'asignada'::public.estado_orden
      else estado end
  where id = p_orden_id and eliminado_en is null;
  if not found then
    raise exception 'La orden no existe' using errcode = 'P0002';
  end if;
end;
$$;

-- Cierra una orden. Si es una instalación exitosa, en la MISMA transacción:
-- crea o actualiza el cliente, ocupa el puerto reservado y activa el servicio.
-- p: {exito, potencia_ont_dbm, potencia_nap_dbm, resultado_pruebas, conformidad_cliente,
--     observaciones, numero_serie_ont, lng, lat}
create or replace function public.cerrar_orden(p_orden_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  o public.ordenes_trabajo%rowtype;
  s public.solicitudes%rowtype;
  v_exito boolean := coalesce((p ->> 'exito')::boolean, true);
  v_cliente uuid;
  v_precio int;
  v_viejo uuid;
begin
  select * into o from public.ordenes_trabajo where id = p_orden_id and eliminado_en is null for update;
  if o.id is null then
    raise exception 'La orden no existe' using errcode = 'P0002';
  end if;
  if not public.puede_ver_orden(p_orden_id) then
    raise exception 'No tiene permiso para cerrar esta orden' using errcode = '42501';
  end if;
  if o.estado in ('completada', 'cancelada') then
    raise exception 'La orden ya está cerrada' using errcode = 'P0001';
  end if;
  if o.tecnico_id is null then
    raise exception 'Asigne un técnico antes de cerrar la orden' using errcode = 'P0001';
  end if;

  update public.ordenes_trabajo set
    estado = 'completada',
    potencia_ont_dbm = public.jtxt(p, 'potencia_ont_dbm')::numeric,
    potencia_nap_dbm = public.jtxt(p, 'potencia_nap_dbm')::numeric,
    resultado_pruebas = coalesce(public.jtxt(p, 'resultado_pruebas'), case when v_exito then 'Exitosa' else 'No exitosa' end),
    conformidad_cliente = (p ->> 'conformidad_cliente')::boolean,
    observaciones = coalesce(public.jtxt(p, 'observaciones'), observaciones),
    iniciada_en = coalesce(iniciada_en, now()),
    ubicacion_cierre = case when public.jtxt(p, 'lng') is not null
                            then public.punto_desde(public.jtxt(p, 'lng')::float8, public.jtxt(p, 'lat')::float8) end
  where id = p_orden_id;

  if o.tipo <> 'instalacion' or o.solicitud_id is null then
    return jsonb_build_object('orden_id', o.id);
  end if;

  select * into s from public.solicitudes where id = o.solicitud_id for update;

  if not v_exito then
    -- La reserva se mantiene para reprogramar la instalación.
    update public.solicitudes set
      estado = 'puerto_reservado',
      reserva_vence_en = now() + make_interval(hours => public.conf_numero('reserva_puerto_horas', 72)::int)
    where id = s.id;
    return jsonb_build_object('orden_id', o.id, 'exito', false);
  end if;

  if s.puerto_reservado_id is null then
    raise exception 'La solicitud no tiene un puerto reservado' using errcode = 'P0001';
  end if;
  select precio_clp into v_precio from public.planes where id = s.plan_id;

  if s.cliente_id is null then
    insert into public.clientes (nombre, rut, telefono, whatsapp, email, direccion_calle, direccion_numero, direccion_depto,
                                 comuna_id, referencia, ubicacion, plan_id, precio_mensual_clp, fecha_contratacion,
                                 estado, numero_serie_ont, creado_por)
    values (s.nombre, s.rut, s.telefono, s.whatsapp, s.email, s.direccion_calle, s.direccion_numero, s.direccion_depto,
            s.comuna_id, s.referencia, s.ubicacion, s.plan_id, v_precio, current_date,
            'activo', public.jtxt(p, 'numero_serie_ont'), (select auth.uid()))
    returning id into v_cliente;
  else
    v_cliente := s.cliente_id;
    select nap_puerto_id into v_viejo from public.clientes where id = v_cliente for update;
    if v_viejo is not null and v_viejo <> s.puerto_reservado_id then
      update public.nap_puertos set estado = 'libre' where id = v_viejo and estado = 'ocupado';
    end if;
    update public.clientes set
      estado = 'activo',
      plan_id = coalesce(s.plan_id, plan_id),
      numero_serie_ont = coalesce(public.jtxt(p, 'numero_serie_ont'), numero_serie_ont),
      ubicacion = coalesce(s.ubicacion, ubicacion)
    where id = v_cliente;
  end if;

  update public.nap_puertos set estado = 'ocupado' where id = s.puerto_reservado_id;
  update public.clientes set nap_puerto_id = s.puerto_reservado_id where id = v_cliente;
  update public.ordenes_trabajo set cliente_id = v_cliente where id = o.id;
  update public.solicitudes set estado = 'activada', cliente_id = v_cliente where id = s.id;

  insert into public.cliente_historial (cliente_id, tipo, descripcion, datos)
  values (v_cliente, 'instalacion', 'Instalación completada (orden ' || o.numero || ')',
          jsonb_build_object('orden_id', o.id, 'solicitud', s.numero,
                             'potencia_ont_dbm', public.jtxt(p, 'potencia_ont_dbm')));

  return jsonb_build_object('orden_id', o.id, 'exito', true, 'cliente_id', v_cliente);
end;
$$;

-- Si se cancela una orden de instalación en curso, la solicitud vuelve a
-- tener solo la reserva (con nuevo plazo) para reprogramarla.
create or replace function public.tg_orden_cancelada()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.estado = 'cancelada' and old.estado <> 'cancelada' and new.tipo = 'instalacion' and new.solicitud_id is not null then
    update public.solicitudes set
      estado = 'puerto_reservado',
      reserva_vence_en = now() + make_interval(hours => public.conf_numero('reserva_puerto_horas', 72)::int)
    where id = new.solicitud_id and estado = 'orden_generada';
  end if;
  return null;
end;
$$;

create trigger ordenes_cancelada
  after update of estado on public.ordenes_trabajo
  for each row execute function public.tg_orden_cancelada();

-- Cancela una solicitud: libera su reserva y cancela sus órdenes abiertas.
create or replace function public.cancelar_solicitud(p_solicitud_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.solicitudes%rowtype;
begin
  if not public.tiene_rol('atencion_cliente', 'supervisor_red') then
    raise exception 'No tiene permiso para cancelar solicitudes' using errcode = '42501';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'Indique el motivo de la cancelación' using errcode = '23502';
  end if;
  select * into s from public.solicitudes where id = p_solicitud_id and eliminado_en is null for update;
  if s.id is null then
    raise exception 'La solicitud no existe' using errcode = 'P0002';
  end if;
  if s.estado in ('activada', 'cancelada') then
    raise exception 'La solicitud ya está %', s.estado using errcode = 'P0001';
  end if;

  update public.solicitudes set estado = 'cancelada', motivo_decision = btrim(p_motivo), reserva_vence_en = null
  where id = s.id;
  update public.ordenes_trabajo set estado = 'cancelada', observaciones = concat_ws(' · ', observaciones, 'Solicitud cancelada: ' || btrim(p_motivo))
  where solicitud_id = s.id and estado not in ('completada', 'cancelada');
  if s.puerto_reservado_id is not null then
    update public.nap_puertos set estado = 'libre' where id = s.puerto_reservado_id and estado = 'reservado';
    update public.solicitudes set puerto_reservado_id = null where id = s.id;
  end if;
end;
$$;

-- Crea órdenes de reparación para los clientes afectados por una falla.
-- No duplica: omite clientes que ya tienen una reparación abierta.
create or replace function public.crear_ordenes_masivas(p_tipo text, p_id uuid, p_descripcion text,
                                                        p_prioridad public.prioridad_orden default 'alta')
returns jsonb
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_impacto jsonb;
  c jsonb;
  k public.clientes%rowtype;
  v_creadas int := 0;
  v_omitidas int := 0;
begin
  perform public.exigir_supervisor();
  if nullif(btrim(p_descripcion), '') is null then
    raise exception 'Describa la falla' using errcode = '23502';
  end if;
  v_impacto := public.impacto(p_tipo, p_id);
  for c in select jsonb_array_elements(n -> 'clientes') from jsonb_array_elements(v_impacto -> 'naps') n loop
    select * into k from public.clientes where id = (c ->> 'id')::uuid;
    if exists (select 1 from public.ordenes_trabajo o
               where o.cliente_id = k.id and o.tipo = 'reparacion'
                 and o.estado not in ('completada', 'cancelada') and o.eliminado_en is null) then
      v_omitidas := v_omitidas + 1;
      continue;
    end if;
    insert into public.ordenes_trabajo (tipo, prioridad, estado, cliente_id, direccion, comuna_id, ubicacion, descripcion)
    values ('reparacion', coalesce(p_prioridad, 'alta'), 'pendiente', k.id,
            concat_ws(' ', k.direccion_calle, k.direccion_numero, k.direccion_depto), k.comuna_id, k.ubicacion,
            btrim(p_descripcion));
    v_creadas := v_creadas + 1;
  end loop;
  return jsonb_build_object('creadas', v_creadas, 'omitidas', v_omitidas);
end;
$$;

-- ---------------------------------------------------------------------
-- Vistas con coordenadas listas para la interfaz (respetan RLS)
-- ---------------------------------------------------------------------
create view public.solicitudes_vista with (security_invoker = true) as
select
  s.id, s.numero, s.estado, s.canal, s.nombre, s.rut, s.telefono, s.whatsapp, s.email,
  s.direccion_calle, s.direccion_numero, s.direccion_depto, s.comuna_id, co.nombre as comuna, s.referencia,
  st_x(s.ubicacion::geometry) as lng, st_y(s.ubicacion::geometry) as lat,
  s.plan_id, pl.nombre as plan, s.cliente_id, s.nap_id, e.codigo as nap_codigo,
  s.puerto_reservado_id, pp.numero as puerto_reservado, s.reserva_vence_en,
  s.factibilidad, s.motivo_decision, s.evaluado_por, ev.nombre_completo as evaluado_por_nombre, s.evaluado_en,
  s.observaciones, s.es_demo, s.creado_en, s.actualizado_en,
  lower(s.numero || ' ' || s.nombre || ' ' || coalesce(s.rut, '') || ' ' || s.direccion_calle || ' '
        || coalesce(s.direccion_numero, '') || ' ' || coalesce(s.telefono, '')) as texto_busqueda
from public.solicitudes s
left join public.comunas co on co.id = s.comuna_id
left join public.planes pl on pl.id = s.plan_id
left join public.elementos_red e on e.id = s.nap_id
left join public.nap_puertos pp on pp.id = s.puerto_reservado_id
left join public.perfiles ev on ev.id = s.evaluado_por
where s.eliminado_en is null;

create view public.ordenes_vista with (security_invoker = true) as
select
  o.id, o.numero, o.tipo, o.prioridad, o.estado, o.cliente_id, o.solicitud_id, o.direccion, o.comuna_id,
  co.nombre as comuna,
  coalesce(st_x(o.ubicacion::geometry), st_x(k.ubicacion::geometry), st_x(s.ubicacion::geometry)) as lng,
  coalesce(st_y(o.ubicacion::geometry), st_y(k.ubicacion::geometry), st_y(s.ubicacion::geometry)) as lat,
  o.tecnico_id, t.nombre_completo as tecnico_nombre, o.fecha_programada, o.descripcion,
  o.potencia_ont_dbm, o.potencia_nap_dbm, o.resultado_pruebas, o.conformidad_cliente, o.observaciones,
  o.iniciada_en, o.cerrada_en, o.es_demo, o.creado_en, o.actualizado_en,
  coalesce(k.nombre, s.nombre) as contacto_nombre,
  coalesce(k.telefono, s.telefono) as contacto_telefono,
  coalesce(k.whatsapp, s.whatsapp) as contacto_whatsapp,
  k.codigo as cliente_codigo, s.numero as solicitud_numero,
  coalesce(ek.codigo, es.codigo) as nap_codigo,
  coalesce(pk.numero, ps.numero) as puerto,
  coalesce(plk.nombre, pls.nombre) as plan,
  lower(o.numero || ' ' || coalesce(k.nombre, s.nombre, '') || ' ' || coalesce(o.direccion, '') || ' '
        || coalesce(t.nombre_completo, '')) as texto_busqueda
from public.ordenes_trabajo o
left join public.clientes k on k.id = o.cliente_id
left join public.solicitudes s on s.id = o.solicitud_id
left join public.comunas co on co.id = o.comuna_id
left join public.perfiles t on t.id = o.tecnico_id
left join public.nap_puertos pk on pk.id = k.nap_puerto_id
left join public.elementos_red ek on ek.id = pk.nap_id
left join public.nap_puertos ps on ps.id = s.puerto_reservado_id
left join public.elementos_red es on es.id = ps.nap_id
left join public.planes plk on plk.id = k.plan_id
left join public.planes pls on pls.id = s.plan_id
where o.eliminado_en is null;

revoke all on public.solicitudes_vista, public.ordenes_vista from anon, public;
grant select on public.solicitudes_vista, public.ordenes_vista to authenticated;

-- Técnicos activos (para asignar órdenes).
create or replace function public.tecnicos_activos()
returns table (id uuid, nombre text, email text, abiertas bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(nullif(p.nombre_completo, ''), p.email), p.email,
         (select count(*) from public.ordenes_trabajo o
          where o.tecnico_id = p.id and o.estado in ('asignada', 'en_camino', 'en_ejecucion') and o.eliminado_en is null)
  from public.perfiles p
  join public.usuario_roles ur on ur.usuario_id = p.id and ur.rol = 'tecnico'
  where p.activo and public.tiene_rol('supervisor_red', 'atencion_cliente')
  order by 2;
$$;

-- ---------------------------------------------------------------------
-- Fotos de órdenes (Storage)
-- ---------------------------------------------------------------------
create table public.orden_fotos (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo (id) on delete cascade,
  ruta text not null unique,                       -- ruta en el bucket "ordenes": <orden_id>/<archivo>
  momento text not null default 'otro' check (momento in ('antes', 'despues', 'otro')),
  descripcion text,
  subida_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  check (ruta like orden_id::text || '/%')
);
create index orden_fotos_orden_idx on public.orden_fotos (orden_id);
alter table public.orden_fotos enable row level security;

create policy orden_fotos_select on public.orden_fotos for select to authenticated
  using (public.puede_ver_orden(orden_id));
create policy orden_fotos_insert on public.orden_fotos for insert to authenticated
  with check (public.puede_ver_orden(orden_id) and subida_por = (select auth.uid()));
create policy orden_fotos_delete on public.orden_fotos for delete to authenticated
  using ((select public.tiene_rol('supervisor_red', 'atencion_cliente')));

create trigger auditar after insert or delete on public.orden_fotos
  for each row execute function public.tg_auditar();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ordenes', 'ordenes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "ordenes: ver fotos" on storage.objects for select to authenticated
  using (bucket_id = 'ordenes' and public.puede_ver_orden(((storage.foldername(name))[1])::uuid));
create policy "ordenes: subir fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'ordenes' and public.puede_ver_orden(((storage.foldername(name))[1])::uuid));
create policy "ordenes: borrar fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'ordenes' and public.tiene_rol('supervisor_red', 'atencion_cliente'));

-- ---------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------
revoke execute on function public.tg_orden_cancelada() from public, anon, authenticated;
revoke execute on function public.liberar_reservas_vencidas() from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.tecnico_tiene_solicitud(uuid)', 'public.puede_ver_orden(uuid)',
    'public.evaluar_factibilidad(uuid)', 'public.decidir_factibilidad(uuid, text, text, uuid)',
    'public.reservar_puerto(uuid, uuid)', 'public.liberar_reserva(uuid)',
    'public.generar_orden_instalacion(uuid, uuid, timestamptz, public.prioridad_orden, text)',
    'public.asignar_orden(uuid, uuid, timestamptz)', 'public.cerrar_orden(uuid, jsonb)',
    'public.cancelar_solicitud(uuid, text)',
    'public.crear_ordenes_masivas(text, uuid, text, public.prioridad_orden)', 'public.tecnicos_activos()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
