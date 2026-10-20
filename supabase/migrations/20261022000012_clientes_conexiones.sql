-- =====================================================================
-- 0012 · Clientes, puertos, conexiones y topología (Etapa 3)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Puerto del cliente: solo se asigna o libera con las funciones de abajo.
-- ---------------------------------------------------------------------

-- En clientes: el puerto no se cambia con un UPDATE directo (solo con las
-- funciones de abajo, que corren como dueño de la base).
create or replace function public.tg_cliente_puerto_guardia()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and new.nap_puerto_id is not null)
          or (tg_op = 'UPDATE' and new.nap_puerto_id is distinct from old.nap_puerto_id)) then
    raise exception 'El puerto se asigna o libera desde la ficha del cliente' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Al retirar un cliente se libera su puerto automáticamente.
create or replace function public.tg_cliente_retiro()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if new.estado = 'retirado' and old.estado <> 'retirado' and old.nap_puerto_id is not null then
    update public.nap_puertos set estado = 'libre' where id = old.nap_puerto_id and estado = 'ocupado';
    new.nap_puerto_id := null;
  end if;
  return new;
end;
$$;

-- Los disparadores BEFORE se ejecutan por orden alfabético: primero la
-- guardia (compara lo que pidió el usuario) y después el retiro.
create trigger clientes_puerto_guardia
  before insert or update on public.clientes
  for each row execute function public.tg_cliente_puerto_guardia();
create trigger clientes_puerto_retiro
  before update of estado on public.clientes
  for each row execute function public.tg_cliente_retiro();

-- Asigna un puerto libre a un cliente. Bloquea la fila del puerto: si dos
-- usuarios eligen el mismo puerto a la vez, el segundo recibe un error.
create or replace function public.asignar_puerto_cliente(p_cliente_id uuid, p_puerto_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_cliente public.clientes%rowtype;
  v_puerto record;
begin
  if not public.tiene_rol('atencion_cliente', 'supervisor_red') then
    raise exception 'No tiene permiso para asignar puertos' using errcode = '42501';
  end if;

  select * into v_cliente from public.clientes where id = p_cliente_id and eliminado_en is null for update;
  if v_cliente.id is null then
    raise exception 'El cliente no existe' using errcode = 'P0002';
  end if;
  if v_cliente.estado = 'retirado' then
    raise exception 'El cliente está retirado; cambie su estado antes de asignarle un puerto' using errcode = 'P0001';
  end if;

  select p.id, p.numero, p.estado, e.codigo, e.estado as estado_nap, e.eliminado_en
  into v_puerto
  from public.nap_puertos p
  join public.elementos_red e on e.id = p.nap_id
  where p.id = p_puerto_id
  for update of p;
  if v_puerto.id is null or v_puerto.eliminado_en is not null then
    raise exception 'El puerto no existe' using errcode = 'P0002';
  end if;
  if v_cliente.nap_puerto_id = p_puerto_id then
    return; -- ya estaba asignado
  end if;
  if v_puerto.estado <> 'libre' then
    raise exception 'El puerto % de % no está libre (está %)', v_puerto.numero, v_puerto.codigo, v_puerto.estado
      using errcode = 'P0001';
  end if;
  if v_puerto.estado_nap = 'retirado' then
    raise exception 'La NAP % está retirada', v_puerto.codigo using errcode = 'P0001';
  end if;

  if v_cliente.nap_puerto_id is not null then
    update public.nap_puertos set estado = 'libre' where id = v_cliente.nap_puerto_id and estado = 'ocupado';
  end if;
  update public.nap_puertos set estado = 'ocupado' where id = p_puerto_id;
  update public.clientes set nap_puerto_id = p_puerto_id where id = p_cliente_id;
end;
$$;

create or replace function public.liberar_puerto_cliente(p_cliente_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_puerto uuid;
begin
  if not public.tiene_rol('atencion_cliente', 'supervisor_red') then
    raise exception 'No tiene permiso para liberar puertos' using errcode = '42501';
  end if;
  select nap_puerto_id into v_puerto from public.clientes where id = p_cliente_id and eliminado_en is null for update;
  if v_puerto is null then
    return;
  end if;
  update public.nap_puertos set estado = 'libre' where id = v_puerto and estado = 'ocupado';
  update public.clientes set nap_puerto_id = null where id = p_cliente_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Conexiones
-- ---------------------------------------------------------------------

-- Mantiene el estado de los hilos según las conexiones vigentes
-- (en uso si alguna conexión lo usa; los dañados o reservados no se tocan).
create or replace function public.tg_conexion_sincronizar_hilos()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  h uuid;
begin
  for h in
    select distinct x from unnest(array[
      case when tg_op <> 'INSERT' then old.hilo_origen_id end,
      case when tg_op <> 'INSERT' then old.hilo_destino_id end,
      case when tg_op <> 'DELETE' then new.hilo_origen_id end,
      case when tg_op <> 'DELETE' then new.hilo_destino_id end
    ]) x where x is not null
  loop
    update public.cable_hilos ch
    set estado = case when exists (
          select 1 from public.conexiones c
          where (c.hilo_origen_id = h or c.hilo_destino_id = h)
            and c.eliminado_en is null and c.estado <> 'retirado'
        ) then 'en_uso'::public.estado_hilo else 'libre'::public.estado_hilo end
    where ch.id = h and ch.estado in ('libre', 'en_uso');
  end loop;
  return null;
end;
$$;

create trigger conexiones_sincronizar_hilos
  after insert or update or delete on public.conexiones
  for each row execute function public.tg_conexion_sincronizar_hilos();

-- Valida que un hilo se pueda usar en una conexión.
create or replace function public.validar_hilo(p_hilo_id uuid)
returns void
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  r record;
begin
  select h.id, h.numero, h.estado, c.codigo as cable, c.eliminado_en, c.estado as estado_cable into r
  from public.cable_hilos h join public.cables c on c.id = h.cable_id
  where h.id = p_hilo_id;
  if r.id is null or r.eliminado_en is not null then
    raise exception 'El hilo no existe' using errcode = 'P0002';
  end if;
  if r.estado = 'danado' then
    raise exception 'El hilo % de % está dañado', r.numero, r.cable using errcode = 'P0001';
  end if;
  if r.estado_cable = 'retirado' then
    raise exception 'El cable % está retirado', r.cable using errcode = 'P0001';
  end if;
end;
$$;

-- Registra que un hilo alimenta a una NAP (sangría del troncal).
create or replace function public.conectar_nap(p_nap_id uuid, p_hilo_id uuid, p_confirmada boolean default false)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_punto geography;
begin
  perform public.exigir_supervisor();
  perform public.validar_hilo(p_hilo_id);
  select ubicacion into v_punto from public.elementos_red where id = p_nap_id and clase = 'nap' and eliminado_en is null;
  if v_punto is null then
    raise exception 'La NAP no existe' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.conexiones where tipo = 'alimentacion_nap' and elemento_id = p_nap_id
             and eliminado_en is null and estado <> 'retirado') then
    raise exception 'La NAP ya tiene una alimentación registrada; elimínela antes de registrar otra' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.conexiones where tipo = 'alimentacion_nap' and hilo_origen_id = p_hilo_id
             and eliminado_en is null and estado <> 'retirado') then
    raise exception 'El hilo ya alimenta a otra NAP' using errcode = 'P0001';
  end if;
  insert into public.conexiones (tipo, hilo_origen_id, elemento_id, punto, confirmada, fecha)
  values ('alimentacion_nap', p_hilo_id, p_nap_id, v_punto, coalesce(p_confirmada, false), current_date)
  returning id into v_id;
  return v_id;
end;
$$;

-- Registra que un puerto PON de la OLT inyecta señal en un hilo.
create or replace function public.inyectar_hilo(p_puerto_pon_id uuid, p_hilo_id uuid, p_confirmada boolean default false)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.exigir_supervisor();
  perform public.validar_hilo(p_hilo_id);
  if not exists (select 1 from public.olt_puertos_pon where id = p_puerto_pon_id) then
    raise exception 'El puerto PON no existe' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.conexiones where tipo = 'inyeccion_olt' and hilo_destino_id = p_hilo_id
             and eliminado_en is null and estado <> 'retirado') then
    raise exception 'El hilo ya recibe señal de un puerto PON' using errcode = 'P0001';
  end if;
  insert into public.conexiones (tipo, olt_puerto_pon_id, hilo_destino_id, confirmada, fecha)
  values ('inyeccion_olt', p_puerto_pon_id, p_hilo_id, coalesce(p_confirmada, false), current_date)
  returning id into v_id;
  return v_id;
end;
$$;

-- Registra un empalme hilo → hilo (por ejemplo, de un cable de derivación al troncal).
create or replace function public.empalmar_hilos(p_hilo_origen uuid, p_hilo_destino uuid, p_elemento_id uuid,
                                                 p_confirmada boolean default false)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.exigir_supervisor();
  perform public.validar_hilo(p_hilo_origen);
  perform public.validar_hilo(p_hilo_destino);
  insert into public.conexiones (tipo, hilo_origen_id, hilo_destino_id, elemento_id, confirmada, fecha)
  values ('empalme_hilos', p_hilo_origen, p_hilo_destino, p_elemento_id, coalesce(p_confirmada, false), current_date)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.confirmar_conexion(p_id uuid, p_confirmada boolean)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.exigir_supervisor();
  update public.conexiones set confirmada = p_confirmada where id = p_id and eliminado_en is null;
  if not found then
    raise exception 'La conexión no existe' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.eliminar_conexion(p_id uuid)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.exigir_supervisor();
  update public.conexiones set eliminado_en = now() where id = p_id and eliminado_en is null;
  if not found then
    raise exception 'La conexión no existe' using errcode = 'P0002';
  end if;
end;
$$;

-- Cables que pasan cerca de un elemento (o nacen/terminan en él), con sus hilos.
create or replace function public.cables_cercanos(p_elemento_id uuid, p_radio_m float8 default 60)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'codigo', c.codigo, 'tipo', c.tipo, 'estado', c.estado,
    'distancia_m', round(st_distance(c.trazado, e.ubicacion)::numeric, 1),
    'hilos', (
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'numero', h.numero, 'tubo', h.tubo, 'color', h.color, 'estado', h.estado,
        'alimenta', (select en.codigo from public.conexiones x join public.elementos_red en on en.id = x.elemento_id
                     where x.tipo = 'alimentacion_nap' and x.hilo_origen_id = h.id
                       and x.eliminado_en is null and x.estado <> 'retirado' limit 1),
        'inyectado', (select pp.etiqueta from public.conexiones x join public.olt_puertos_pon pp on pp.id = x.olt_puerto_pon_id
                      where x.tipo = 'inyeccion_olt' and x.hilo_destino_id = h.id
                        and x.eliminado_en is null and x.estado <> 'retirado' limit 1)
      ) order by h.numero)
      from public.cable_hilos h where h.cable_id = c.id)
  ) order by st_distance(c.trazado, e.ubicacion)), '[]'::jsonb)
  from public.elementos_red e
  join public.cables c on c.eliminado_en is null
    and (c.origen_id = e.id or c.destino_id = e.id or st_dwithin(c.trazado, e.ubicacion, p_radio_m))
  where e.id = p_elemento_id;
$$;

-- ---------------------------------------------------------------------
-- Camino de cada NAP hasta la OLT (topología lógica)
-- ---------------------------------------------------------------------
-- Recorre solo conexiones registradas: NAP ← hilo [← empalmes/splitters] ← PON.
-- Devuelve {completo, pasos: [...desde la NAP hacia la OLT], faltante}.
create or replace function public.camino_nap(p_nap_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_nap record;
  v_pasos jsonb := '[]'::jsonb;
  v_hilo uuid;
  v_conexion record;
  v_hilo_r record;
  v_vistos uuid[] := '{}';
  i int := 0;
begin
  select e.id, e.codigo, e.estado into v_nap from public.elementos_red e
  where e.id = p_nap_id and e.clase = 'nap' and e.eliminado_en is null;
  if v_nap.id is null then
    return null;
  end if;
  v_pasos := jsonb_build_array(jsonb_build_object('tipo', 'nap', 'id', v_nap.id, 'codigo', v_nap.codigo, 'estado', v_nap.estado));

  select * into v_conexion from public.conexiones
  where tipo = 'alimentacion_nap' and elemento_id = p_nap_id and eliminado_en is null and estado <> 'retirado'
  limit 1;
  if v_conexion.id is null then
    return jsonb_build_object('completo', false, 'pasos', v_pasos, 'faltante', 'La NAP no tiene alimentación registrada');
  end if;
  v_hilo := v_conexion.hilo_origen_id;

  loop
    i := i + 1;
    if i > 30 or v_hilo = any (v_vistos) then
      return jsonb_build_object('completo', false, 'pasos', v_pasos, 'faltante', 'Las conexiones registradas forman un ciclo');
    end if;
    v_vistos := v_vistos || v_hilo;

    select h.id, h.numero, h.color, h.estado, c.id as cable_id, c.codigo as cable_codigo, c.estado as cable_estado
    into v_hilo_r
    from public.cable_hilos h join public.cables c on c.id = h.cable_id where h.id = v_hilo;
    v_pasos := v_pasos || jsonb_build_object(
      'tipo', 'hilo', 'id', v_hilo_r.id, 'numero', v_hilo_r.numero, 'color', v_hilo_r.color, 'estado', v_hilo_r.estado,
      'cable_id', v_hilo_r.cable_id, 'cable_codigo', v_hilo_r.cable_codigo, 'cable_estado', v_hilo_r.cable_estado,
      'conexion_id', v_conexion.id, 'confirmada', v_conexion.confirmada);

    -- ¿Qué entrega señal a este hilo?
    select * into v_conexion from public.conexiones
    where hilo_destino_id = v_hilo and eliminado_en is null and estado <> 'retirado'
      and tipo in ('inyeccion_olt', 'empalme_hilos', 'salida_splitter')
    limit 1;

    if v_conexion.id is null then
      return jsonb_build_object('completo', false, 'pasos', v_pasos,
        'faltante', format('Sin conexión registrada hacia la OLT desde el hilo %s de %s', v_hilo_r.numero, v_hilo_r.cable_codigo));
    end if;

    if v_conexion.tipo = 'inyeccion_olt' then
      v_pasos := v_pasos || (
        select jsonb_build_object('tipo', 'pon', 'id', pp.id, 'etiqueta', pp.etiqueta,
                                  'olt_id', oe.id, 'olt_codigo', oe.codigo, 'olt_estado', oe.estado,
                                  'conexion_id', v_conexion.id, 'confirmada', v_conexion.confirmada)
        from public.olt_puertos_pon pp join public.elementos_red oe on oe.id = pp.olt_id
        where pp.id = v_conexion.olt_puerto_pon_id);
      return jsonb_build_object('completo', true, 'pasos', v_pasos, 'faltante', null);
    elsif v_conexion.tipo = 'empalme_hilos' then
      v_pasos := v_pasos || jsonb_build_object('tipo', 'empalme', 'conexion_id', v_conexion.id, 'confirmada', v_conexion.confirmada,
        'elemento_id', v_conexion.elemento_id,
        'codigo', (select codigo from public.elementos_red where id = v_conexion.elemento_id));
      v_hilo := v_conexion.hilo_origen_id;
    else -- salida de splitter independiente
      v_pasos := v_pasos || jsonb_build_object('tipo', 'splitter', 'elemento_id', v_conexion.elemento_id,
        'codigo', (select codigo from public.elementos_red where id = v_conexion.elemento_id),
        'estado', (select estado from public.elementos_red where id = v_conexion.elemento_id),
        'conexion_id', v_conexion.id, 'confirmada', v_conexion.confirmada);
      select * into v_conexion from public.conexiones
      where tipo = 'alimentacion_splitter' and elemento_id = v_conexion.elemento_id
        and eliminado_en is null and estado <> 'retirado' limit 1;
      if v_conexion.id is null then
        return jsonb_build_object('completo', false, 'pasos', v_pasos, 'faltante', 'El splitter no tiene alimentación registrada');
      end if;
      v_hilo := v_conexion.hilo_origen_id;
    end if;
  end loop;
end;
$$;

-- Camino de todas las NAP vigentes (base de topología e impacto).
create or replace function public.caminos_nap()
returns table (nap_id uuid, codigo text, estado public.estado_elemento, camino jsonb)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select e.id, e.codigo, e.estado, public.camino_nap(e.id)
  from public.elementos_red e
  where e.clase = 'nap' and e.eliminado_en is null and e.estado <> 'retirado';
$$;

-- Ruta registrada de un cliente: cliente → puerto → NAP → ... → OLT.
create or replace function public.ruta_cliente(p_cliente_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  c record;
  v_camino jsonb;
begin
  select k.id, k.codigo, k.nombre, k.estado, p.id as puerto_id, p.numero, p.nap_id
  into c
  from public.clientes k left join public.nap_puertos p on p.id = k.nap_puerto_id
  where k.id = p_cliente_id and k.eliminado_en is null;
  if c.id is null then
    return null;  -- no existe o el rol no puede verlo
  end if;
  if c.puerto_id is null then
    return jsonb_build_object('completo', false, 'pasos', '[]'::jsonb, 'faltante', 'El cliente no tiene puerto asignado');
  end if;
  v_camino := public.camino_nap(c.nap_id);
  return jsonb_build_object(
    'completo', v_camino -> 'completo',
    'faltante', v_camino -> 'faltante',
    'pasos', jsonb_build_array(jsonb_build_object('tipo', 'puerto', 'id', c.puerto_id, 'numero', c.numero))
             || (v_camino -> 'pasos'));
end;
$$;

-- NAP y clientes afectados si falla un cable, hilo, puerto PON o elemento.
-- p_tipo: 'cable' | 'hilo' | 'pon' | 'elemento'
create or replace function public.impacto(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_naps jsonb;
begin
  if p_tipo not in ('cable', 'hilo', 'pon', 'elemento') then
    raise exception 'Tipo de análisis no válido' using errcode = '22023';
  end if;

  with afectadas as (
    select c.nap_id, c.codigo, c.camino
    from public.caminos_nap() c
    where case p_tipo
      when 'cable' then c.camino -> 'pasos' @> jsonb_build_array(jsonb_build_object('cable_id', p_id))
      when 'hilo'  then c.camino -> 'pasos' @> jsonb_build_array(jsonb_build_object('tipo', 'hilo', 'id', p_id))
      when 'pon'   then c.camino -> 'pasos' @> jsonb_build_array(jsonb_build_object('tipo', 'pon', 'id', p_id))
      else c.nap_id = p_id
           or c.camino -> 'pasos' @> jsonb_build_array(jsonb_build_object('olt_id', p_id))
           or c.camino -> 'pasos' @> jsonb_build_array(jsonb_build_object('elemento_id', p_id))
           -- Postes o cámaras por donde pasa un cable del camino
           or exists (select 1 from jsonb_array_elements(c.camino -> 'pasos') s
                      join public.cable_soportes cs on cs.cable_id = (s ->> 'cable_id')::uuid
                      where cs.elemento_id = p_id)
    end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.nap_id, 'codigo', a.codigo,
    'puertos_ocupados', (select count(*) from public.nap_puertos p where p.nap_id = a.nap_id and p.estado = 'ocupado'),
    'clientes', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'codigo', k.codigo, 'nombre', k.nombre, 'telefono', k.telefono,
                                          'whatsapp', k.whatsapp, 'estado', k.estado, 'puerto', p.numero)
                       order by p.numero)
      from public.nap_puertos p join public.clientes k on k.nap_puerto_id = p.id
      where p.nap_id = a.nap_id and k.estado <> 'retirado' and k.eliminado_en is null), '[]'::jsonb)
  ) order by a.codigo), '[]'::jsonb)
  into v_naps
  from afectadas a;

  return jsonb_build_object(
    'naps', v_naps,
    'total_naps', jsonb_array_length(v_naps),
    'total_puertos_ocupados', (select coalesce(sum((n ->> 'puertos_ocupados')::int), 0) from jsonb_array_elements(v_naps) n));
end;
$$;

-- Árbol lógico: OLT → PON → NAP, más las NAP sin ruta completa.
create or replace function public.topologia()
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with c as (
    select cn.nap_id, cn.codigo, cn.estado, cn.camino,
           (cn.camino ->> 'completo')::boolean as completo,
           (select x from jsonb_array_elements(cn.camino -> 'pasos') x where x ->> 'tipo' = 'pon') as pon,
           (select n.capacidad_puertos from public.nap n where n.elemento_id = cn.nap_id) as capacidad,
           (select count(*) from public.nap_puertos p where p.nap_id = cn.nap_id and p.estado = 'ocupado') as ocupados
    from public.caminos_nap() cn
  )
  select jsonb_build_object(
    'olts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'codigo', o.codigo, 'estado', o.estado,
        'pons', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pp.id, 'etiqueta', pp.etiqueta,
            'naps', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', c.nap_id, 'codigo', c.codigo, 'estado', c.estado,
                'capacidad', c.capacidad, 'ocupados', c.ocupados,
                'pasos', c.camino -> 'pasos'
              ) order by c.codigo)
              from c where c.completo and (c.pon ->> 'id')::uuid = pp.id), '[]'::jsonb)
          ) order by pp.slot, pp.puerto)
          from public.olt_puertos_pon pp where pp.olt_id = o.id), '[]'::jsonb)
      ) order by o.codigo)
      from public.elementos_red o
      where o.clase = 'olt' and o.eliminado_en is null), '[]'::jsonb),
    'sin_ruta', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.nap_id, 'codigo', c.codigo, 'estado', c.estado,
                                          'capacidad', c.capacidad, 'ocupados', c.ocupados,
                                          'faltante', c.camino ->> 'faltante', 'pasos', c.camino -> 'pasos')
                       order by c.codigo)
      from c where not c.completo), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- Apoyo a clientes
-- ---------------------------------------------------------------------

-- NAP cercanas a un punto con su disponibilidad y si tienen ruta a la OLT.
create or replace function public.naps_cercanas(p_lng float8, p_lat float8, p_radio_m float8 default 500, p_limite int default 10)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with punto as (select public.punto_desde(p_lng, p_lat) as g)
  select coalesce(jsonb_agg(x order by (x ->> 'distancia_m')::numeric), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', e.id, 'codigo', e.codigo, 'nombre', e.nombre, 'estado', e.estado,
      'distancia_m', round(st_distance(e.ubicacion, punto.g)::numeric, 1),
      'capacidad', n.capacidad_puertos,
      'ratio', (select ratio from public.ratios_splitter where id = n.ratio_splitter_id),
      'libres', (select count(*) from public.nap_puertos p where p.nap_id = e.id and p.estado = 'libre'),
      'puertos_libres', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'numero', p.numero) order by p.numero)
                                  from public.nap_puertos p where p.nap_id = e.id and p.estado = 'libre'), '[]'::jsonb),
      'ruta_completa', coalesce((public.camino_nap(e.id) ->> 'completo')::boolean, false),
      'lng', st_x(e.ubicacion::geometry), 'lat', st_y(e.ubicacion::geometry)
    ) as x
    from public.elementos_red e
    join public.nap n on n.elemento_id = e.id
    cross join punto
    where e.eliminado_en is null and e.estado <> 'retirado'
      and st_dwithin(e.ubicacion, punto.g, p_radio_m)
    order by st_distance(e.ubicacion, punto.g)
    limit p_limite
  ) s;
$$;

-- Clientes en la zona visible del mapa (RLS decide cuáles ve cada rol).
create or replace function public.mapa_clientes(p_oeste float8, p_sur float8, p_este float8, p_norte float8)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id, 'codigo', k.codigo, 'nombre', k.nombre, 'estado', k.estado,
    'lng', st_x(k.ubicacion::geometry), 'lat', st_y(k.ubicacion::geometry),
    'nap_lng', st_x(e.ubicacion::geometry), 'nap_lat', st_y(e.ubicacion::geometry), 'nap_codigo', e.codigo,
    'puerto', p.numero
  )), '[]'::jsonb)
  from public.clientes k
  left join public.nap_puertos p on p.id = k.nap_puerto_id
  left join public.elementos_red e on e.id = p.nap_id
  where k.eliminado_en is null and k.ubicacion is not null and k.estado <> 'retirado'
    and st_intersects(k.ubicacion, st_makeenvelope(p_oeste, p_sur, p_este, p_norte, 4326)::geography);
$$;

-- Posibles duplicados al registrar un cliente (mismo RUT o misma dirección).
create or replace function public.clientes_similares(p_rut text, p_calle text, p_numero text, p_comuna_id int,
                                                     p_excluir uuid default null)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', k.id, 'codigo', k.codigo, 'nombre', k.nombre, 'estado', k.estado,
    'motivo', case when k.rut = public.rut_normalizar(p_rut) then 'rut' else 'direccion' end)), '[]'::jsonb)
  from public.clientes k
  where k.eliminado_en is null
    and (p_excluir is null or k.id <> p_excluir)
    and (k.rut = public.rut_normalizar(p_rut)
         or (lower(btrim(k.direccion_calle)) = lower(btrim(p_calle))
             and coalesce(lower(btrim(k.direccion_numero)), '') = coalesce(lower(btrim(p_numero)), '')
             and k.comuna_id = p_comuna_id));
$$;

-- Ubicación del cliente desde la interfaz (lng/lat), sin exponer el tipo geography.
create or replace function public.ubicar_cliente(p_cliente_id uuid, p_lng float8, p_lat float8)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  update public.clientes
  set ubicacion = case when p_lng is null or p_lat is null then null else public.punto_desde(p_lng, p_lat) end
  where id = p_cliente_id and eliminado_en is null;
  if not found then
    raise exception 'El cliente no existe o no tiene permiso para editarlo' using errcode = 'P0002';
  end if;
end;
$$;

-- Coordenadas del cliente para la interfaz.
create or replace function public.coordenadas_cliente(p_cliente_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select case when k.ubicacion is null then null
              else jsonb_build_object('lng', st_x(k.ubicacion::geometry), 'lat', st_y(k.ubicacion::geometry)) end
  from public.clientes k where k.id = p_cliente_id;
$$;

-- Listado de clientes con nombres de comuna, plan y NAP. security_invoker:
-- respeta el RLS de clientes (cada rol ve solo lo que puede ver).
create view public.clientes_vista with (security_invoker = true) as
select
  k.id, k.codigo, k.nombre, k.rut, k.telefono, k.whatsapp, k.email,
  k.direccion_calle, k.direccion_numero, k.direccion_depto, k.comuna_id, co.nombre as comuna, k.referencia,
  k.plan_id, pl.nombre as plan, k.precio_mensual_clp, coalesce(k.precio_mensual_clp, pl.precio_clp) as precio_efectivo_clp,
  k.fecha_contratacion, k.numero_contrato, k.estado, k.nap_puerto_id, p.numero as puerto, e.id as nap_id, e.codigo as nap_codigo,
  k.acometida_cable_id, k.numero_serie_ont, k.observaciones, k.es_demo, k.creado_en, k.actualizado_en,
  (k.ubicacion is not null) as tiene_ubicacion,
  lower(k.codigo || ' ' || k.nombre || ' ' || k.rut || ' ' || k.direccion_calle || ' ' || coalesce(k.direccion_numero, '')
        || ' ' || coalesce(k.telefono, '') || ' ' || coalesce(k.numero_contrato, '')) as texto_busqueda
from public.clientes k
left join public.comunas co on co.id = k.comuna_id
left join public.planes pl on pl.id = k.plan_id
left join public.nap_puertos p on p.id = k.nap_puerto_id
left join public.elementos_red e on e.id = p.nap_id
where k.eliminado_en is null;

revoke all on public.clientes_vista from anon, public;
grant select on public.clientes_vista to authenticated;

-- ---------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------
revoke execute on function public.tg_cliente_puerto_guardia(), public.tg_cliente_retiro(),
  public.tg_conexion_sincronizar_hilos()
  from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.asignar_puerto_cliente(uuid, uuid)',
    'public.liberar_puerto_cliente(uuid)', 'public.validar_hilo(uuid)',
    'public.conectar_nap(uuid, uuid, boolean)', 'public.inyectar_hilo(uuid, uuid, boolean)',
    'public.empalmar_hilos(uuid, uuid, uuid, boolean)', 'public.confirmar_conexion(uuid, boolean)',
    'public.eliminar_conexion(uuid)', 'public.cables_cercanos(uuid, float8)', 'public.camino_nap(uuid)',
    'public.caminos_nap()', 'public.ruta_cliente(uuid)', 'public.impacto(text, uuid)', 'public.topologia()',
    'public.naps_cercanas(float8, float8, float8, int)',
    'public.mapa_clientes(float8, float8, float8, float8)',
    'public.clientes_similares(text, text, text, int, uuid)',
    'public.ubicar_cliente(uuid, float8, float8)', 'public.coordenadas_cliente(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
