-- =====================================================================
-- 0011 · Mapa de la red (Etapa 2)
-- =====================================================================
-- Funciones que usa el mapa: carga por zona visible (con agrupación según
-- el zoom), alta/edición/movimiento/baja de elementos y cables, búsqueda y
-- fichas de detalle. Todas corren con los permisos de quien llama
-- (security invoker), así que RLS sigue decidiendo qué se ve y qué se edita.

insert into public.configuracion (clave, valor, descripcion) values
  ('mapa_teselas', jsonb_build_object(
      'url', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      'atribucion', '&copy; colaboradores de OpenStreetMap',
      'zoom_maximo', 19),
   'Capa base del mapa. Para producción con mucho uso, cambie a un proveedor de teselas propio o contratado'),
  ('mapa_satelite', jsonb_build_object(
      'url', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      'atribucion', 'Imágenes &copy; Esri',
      'zoom_maximo', 19),
   'Capa satelital opcional del mapa'),
  ('mapa_zoom_detalle', '16'::jsonb, 'Desde este zoom el mapa muestra cada elemento en vez de grupos'),
  ('mapa_max_elementos', '600'::jsonb, 'Si en la zona visible hay más elementos que esto, se muestran agrupados'),
  ('mapa_ajuste_metros', '30'::jsonb, 'Distancia máxima para unir el extremo de un cable a un elemento al dibujarlo');

-- ---------------------------------------------------------------------
-- Estados de puerto: libre ↔ averiado se cambia a mano; ocupado y
-- reservado solo los asignan las funciones de instalación (Etapas 3 y 4).
-- ---------------------------------------------------------------------
create or replace function public.tg_nap_puerto_guardia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.estado is distinct from old.estado
     and (old.estado in ('ocupado', 'reservado') or new.estado in ('ocupado', 'reservado')) then
    raise exception 'Los puertos ocupados o reservados se gestionan desde clientes y solicitudes'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger nap_puertos_guardia
  before update of estado on public.nap_puertos
  for each row execute function public.tg_nap_puerto_guardia();

-- ---------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------
create or replace function public.conf_numero(p_clave text, p_defecto numeric)
returns numeric
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce((select (valor #>> '{}')::numeric from public.configuracion where clave = p_clave), p_defecto);
$$;

create or replace function public.punto_desde(p_lng float8, p_lat float8)
returns geography
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
begin
  if p_lng is null or p_lat is null or p_lng not between -180 and 180 or p_lat not between -90 and 90 then
    raise exception 'Coordenadas no válidas' using errcode = '22023';
  end if;
  return st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
end;
$$;

-- Construye una línea desde [[lng,lat], ...] (mínimo 2 puntos).
create or replace function public.linea_desde(p_coordenadas jsonb)
returns geography
language plpgsql
immutable
set search_path = public, extensions, pg_temp
as $$
declare
  c jsonb;
begin
  if p_coordenadas is null or jsonb_typeof(p_coordenadas) <> 'array' or jsonb_array_length(p_coordenadas) < 2 then
    raise exception 'El trazado necesita al menos dos puntos' using errcode = '22023';
  end if;
  for c in select * from jsonb_array_elements(p_coordenadas) loop
    if jsonb_typeof(c) <> 'array' or jsonb_array_length(c) < 2
       or (c ->> 0)::float8 not between -180 and 180 or (c ->> 1)::float8 not between -90 and 90 then
      raise exception 'Coordenada del trazado no válida: %', c using errcode = '22023';
    end if;
  end loop;
  return st_setsrid(st_geomfromgeojson(jsonb_build_object('type', 'LineString', 'coordinates', p_coordenadas)::text), 4326)::geography;
end;
$$;

-- Coordenadas [[lng,lat], ...] de una línea.
create or replace function public.coordenadas_de(p_linea geography)
returns jsonb
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select (st_asgeojson(p_linea, 7)::jsonb) -> 'coordinates';
$$;

-- Ubica los extremos del trazado exactamente sobre el origen y el destino.
create or replace function public.ajustar_extremos(p_coordenadas jsonb, p_origen uuid, p_destino uuid)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  r jsonb := p_coordenadas;
  v_punto geography;
begin
  if p_origen is not null then
    select ubicacion into v_punto from public.elementos_red where id = p_origen and eliminado_en is null;
    if v_punto is null then
      raise exception 'El elemento de origen no existe' using errcode = 'P0002';
    end if;
    r := jsonb_set(r, '{0}', jsonb_build_array(st_x(v_punto::geometry), st_y(v_punto::geometry)));
  end if;
  if p_destino is not null then
    select ubicacion into v_punto from public.elementos_red where id = p_destino and eliminado_en is null;
    if v_punto is null then
      raise exception 'El elemento de destino no existe' using errcode = 'P0002';
    end if;
    r := jsonb_set(r, '{-1}', jsonb_build_array(st_x(v_punto::geometry), st_y(v_punto::geometry)));
  end if;
  return r;
end;
$$;

create or replace function public.exigir_supervisor()
returns void
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.tiene_rol('supervisor_red') then
    raise exception 'Solo el supervisor de red puede modificar la infraestructura' using errcode = '42501';
  end if;
end;
$$;

-- Texto de un campo jsonb, null si viene vacío.
create or replace function public.jtxt(p jsonb, k text)
returns text
language sql
immutable
set search_path = public, extensions, pg_temp
as $$
  select nullif(btrim(p ->> k), '');
$$;

-- ---------------------------------------------------------------------
-- Carga del mapa por zona visible
-- ---------------------------------------------------------------------

-- Elementos vigentes dentro del rectángulo, con filtros opcionales.
create or replace function public.elementos_en_zona(
  p_oeste float8, p_sur float8, p_este float8, p_norte float8,
  p_clases public.clase_elemento[], p_estados public.estado_elemento[], p_sector text
)
returns table (id uuid, clase public.clase_elemento, x float8, y float8)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select e.id, e.clase, st_x(e.ubicacion::geometry), st_y(e.ubicacion::geometry)
  from public.elementos_red e
  where e.eliminado_en is null
    and st_intersects(e.ubicacion, st_makeenvelope(p_oeste, p_sur, p_este, p_norte, 4326)::geography)
    and (p_clases is null or e.clase = any (p_clases))
    and (p_estados is null or e.estado = any (p_estados))
    and (p_sector is null or e.sector ilike '%' || p_sector || '%');
$$;

-- Elementos dentro del rectángulo visible. Si son muchos y el zoom es bajo,
-- devuelve grupos (cantidad y centro) en vez de cada elemento.
create or replace function public.mapa_elementos(
  p_oeste float8, p_sur float8, p_este float8, p_norte float8, p_zoom int,
  p_clases public.clase_elemento[] default null,
  p_estados public.estado_elemento[] default null,
  p_sector text default null
)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_total int;
  v_celda float8;
begin
  select count(*) into v_total
  from public.elementos_en_zona(p_oeste, p_sur, p_este, p_norte, p_clases, p_estados, p_sector);

  if p_zoom < public.conf_numero('mapa_zoom_detalle', 16)
     and v_total > public.conf_numero('mapa_max_elementos', 600) then
    v_celda := greatest((p_este - p_oeste) / 12.0, 1e-6);
    return jsonb_build_object(
      'modo', 'grupos',
      'total', v_total,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'cantidad', g.cantidad, 'lng', g.lng, 'lat', g.lat, 'nap', g.nap))
        from (
          select count(*) as cantidad, avg(s.x) as lng, avg(s.y) as lat,
                 count(*) filter (where s.clase = 'nap') as nap
          from public.elementos_en_zona(p_oeste, p_sur, p_este, p_norte, p_clases, p_estados, p_sector) s
          group by floor(s.x / v_celda), floor(s.y / v_celda)
        ) g), '[]'::jsonb));
  end if;

  return jsonb_build_object(
    'modo', 'elementos',
    'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'codigo', e.codigo, 'clase', e.clase, 'tipo', e.tipo_codigo,
        'tipo_nombre', t.nombre, 'color', t.color, 'nombre', e.nombre, 'estado', e.estado,
        'sector', e.sector, 'lng', s.x, 'lat', s.y,
        'nap', case when e.clase = 'nap' then (
          select jsonb_build_object(
            'capacidad', n.capacidad_puertos,
            'ratio', r.ratio,
            'libres', count(*) filter (where p.estado = 'libre'),
            'ocupados', count(*) filter (where p.estado = 'ocupado'),
            'reservados', count(*) filter (where p.estado = 'reservado'),
            'averiados', count(*) filter (where p.estado = 'averiado'))
          from public.nap n
          join public.ratios_splitter r on r.id = n.ratio_splitter_id
          left join public.nap_puertos p on p.nap_id = n.elemento_id
          where n.elemento_id = e.id
          group by n.capacidad_puertos, r.ratio) end
      ) order by e.codigo)
      from public.elementos_en_zona(p_oeste, p_sur, p_este, p_norte, p_clases, p_estados, p_sector) s
      join public.elementos_red e on e.id = s.id
      join public.tipos_elemento t on t.codigo = e.tipo_codigo), '[]'::jsonb));
end;
$$;

-- Cables que cruzan el rectángulo visible, con su geometría en GeoJSON.
create or replace function public.mapa_cables(
  p_oeste float8, p_sur float8, p_este float8, p_norte float8,
  p_tipos public.tipo_cable[] default null,
  p_estados public.estado_elemento[] default null
)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'codigo', c.codigo, 'nombre_tramo', c.nombre_tramo, 'tipo', c.tipo, 'estado', c.estado,
    'cantidad_fibras', c.cantidad_fibras,
    'hilos_usados', (select count(*) from public.cable_hilos h where h.cable_id = c.id and h.estado <> 'libre'),
    'longitud_mapa_m', c.longitud_mapa_m, 'longitud_declarada_m', c.longitud_declarada_m,
    'origen_id', c.origen_id, 'destino_id', c.destino_id,
    'coordenadas', public.coordenadas_de(c.trazado)
  ) order by c.tipo, c.codigo), '[]'::jsonb)
  from public.cables c
  where c.eliminado_en is null
    and st_intersects(c.trazado, st_makeenvelope(p_oeste, p_sur, p_este, p_norte, 4326)::geography)
    and (p_tipos is null or c.tipo = any (p_tipos))
    and (p_estados is null or c.estado = any (p_estados));
$$;

create or replace function public.mapa_zonas(p_oeste float8, p_sur float8, p_este float8, p_norte float8)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'nombre', z.nombre, 'estado', z.estado, 'color', z.color,
    'geometria', st_asgeojson(z.area, 7)::jsonb)), '[]'::jsonb)
  from public.zonas_cobertura z
  where z.eliminado_en is null
    and st_intersects(z.area, st_makeenvelope(p_oeste, p_sur, p_este, p_norte, 4326)::geography);
$$;

-- ---------------------------------------------------------------------
-- Elementos: alta, edición, movimiento y baja
-- ---------------------------------------------------------------------

-- Guarda los datos propios de la clase (tabla de detalle).
create or replace function public.guardar_detalle_elemento(p_id uuid, p_clase public.clase_elemento, d jsonb, p_nuevo boolean)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_ratio int;
  v_capacidad int;
  v_pon int;
begin
  d := coalesce(d, '{}'::jsonb);
  case p_clase
  when 'nap' then
    v_ratio := public.jtxt(d, 'ratio_splitter_id')::int;
    if v_ratio is null then
      raise exception 'Indique el ratio del splitter de la NAP' using errcode = '23502';
    end if;
    v_capacidad := coalesce(public.jtxt(d, 'capacidad_puertos')::int,
                            (select salidas from public.ratios_splitter where id = v_ratio));
    if p_nuevo then
      insert into public.nap (elemento_id, ratio_splitter_id, capacidad_puertos, modelo, tecnico_responsable_id)
      values (p_id, v_ratio, v_capacidad, public.jtxt(d, 'modelo'), public.jtxt(d, 'tecnico_responsable_id')::uuid);
    else
      update public.nap set ratio_splitter_id = v_ratio, capacidad_puertos = v_capacidad,
             modelo = public.jtxt(d, 'modelo'), tecnico_responsable_id = public.jtxt(d, 'tecnico_responsable_id')::uuid
      where elemento_id = p_id;
    end if;
  when 'olt' then
    if p_nuevo then
      insert into public.olts (elemento_id, marca, modelo, tecnologia, numero_serie, ip_gestion)
      values (p_id, public.jtxt(d, 'marca'), public.jtxt(d, 'modelo'), coalesce(public.jtxt(d, 'tecnologia'), 'GPON'),
              public.jtxt(d, 'numero_serie'), public.jtxt(d, 'ip_gestion')::inet);
      v_pon := coalesce(public.jtxt(d, 'puertos_pon')::int, 0);
      if v_pon not between 0 and 256 then
        raise exception 'Cantidad de puertos PON no válida' using errcode = '22023';
      end if;
      insert into public.olt_puertos_pon (olt_id, slot, puerto, etiqueta)
      select p_id, 0, g, 'PON 0/' || g from generate_series(1, v_pon) g;
    else
      update public.olts set marca = public.jtxt(d, 'marca'), modelo = public.jtxt(d, 'modelo'),
             tecnologia = coalesce(public.jtxt(d, 'tecnologia'), 'GPON'),
             numero_serie = public.jtxt(d, 'numero_serie'), ip_gestion = public.jtxt(d, 'ip_gestion')::inet
      where elemento_id = p_id;
    end if;
  when 'poste' then
    insert into public.postes (elemento_id, material, altura_m, propietario, numero_placa)
    values (p_id, public.jtxt(d, 'material'), public.jtxt(d, 'altura_m')::numeric,
            public.jtxt(d, 'propietario'), public.jtxt(d, 'numero_placa'))
    on conflict (elemento_id) do update set material = excluded.material, altura_m = excluded.altura_m,
      propietario = excluded.propietario, numero_placa = excluded.numero_placa;
  when 'camara' then
    insert into public.camaras (elemento_id, tipo, dimensiones)
    values (p_id, public.jtxt(d, 'tipo'), public.jtxt(d, 'dimensiones'))
    on conflict (elemento_id) do update set tipo = excluded.tipo, dimensiones = excluded.dimensiones;
  when 'caja_empalme' then
    insert into public.cajas_empalme (elemento_id, modelo, capacidad_empalmes)
    values (p_id, public.jtxt(d, 'modelo'), public.jtxt(d, 'capacidad_empalmes')::int)
    on conflict (elemento_id) do update set modelo = excluded.modelo, capacidad_empalmes = excluded.capacidad_empalmes;
  when 'splitter' then
    v_ratio := public.jtxt(d, 'ratio_splitter_id')::int;
    if v_ratio is null then
      raise exception 'Indique el ratio del splitter' using errcode = '23502';
    end if;
    insert into public.splitters (elemento_id, ratio_splitter_id) values (p_id, v_ratio)
    on conflict (elemento_id) do update set ratio_splitter_id = excluded.ratio_splitter_id;
  when 'gabinete' then
    insert into public.gabinetes (elemento_id, descripcion) values (p_id, public.jtxt(d, 'descripcion'))
    on conflict (elemento_id) do update set descripcion = excluded.descripcion;
  when 'punto_ingreso' then
    insert into public.puntos_ingreso (elemento_id, edificio, pisos, contacto_administracion)
    values (p_id, public.jtxt(d, 'edificio'), public.jtxt(d, 'pisos')::int, public.jtxt(d, 'contacto_administracion'))
    on conflict (elemento_id) do update set edificio = excluded.edificio, pisos = excluded.pisos,
      contacto_administracion = excluded.contacto_administracion;
  else
    null; -- clase "otro": sin datos propios
  end case;
end;
$$;

-- Crea un elemento con sus datos propios en una sola transacción.
-- p: {clase, tipo_codigo, codigo, nombre, lng, lat, direccion, comuna_id, sector,
--     estado, fecha_instalacion, observaciones, detalle: {...}}
create or replace function public.crear_elemento(p jsonb)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_clase public.clase_elemento := public.jtxt(p, 'clase')::public.clase_elemento;
  v_id uuid;
begin
  perform public.exigir_supervisor();
  if v_clase is null then
    raise exception 'Indique la clase del elemento' using errcode = '23502';
  end if;

  insert into public.elementos_red (codigo, clase, tipo_codigo, nombre, ubicacion, direccion, comuna_id, sector,
                                    estado, fecha_instalacion, observaciones)
  values (
    upper(public.jtxt(p, 'codigo')),
    v_clase,
    coalesce(public.jtxt(p, 'tipo_codigo'), v_clase::text),
    public.jtxt(p, 'nombre'),
    public.punto_desde(public.jtxt(p, 'lng')::float8, public.jtxt(p, 'lat')::float8),
    public.jtxt(p, 'direccion'),
    public.jtxt(p, 'comuna_id')::int,
    public.jtxt(p, 'sector'),
    coalesce(public.jtxt(p, 'estado'), 'operativo')::public.estado_elemento,
    public.jtxt(p, 'fecha_instalacion')::date,
    public.jtxt(p, 'observaciones')
  )
  returning id into v_id;

  perform public.guardar_detalle_elemento(v_id, v_clase, p -> 'detalle', true);
  return v_id;
end;
$$;

-- Actualiza datos comunes y propios. La clase no cambia.
create or replace function public.actualizar_elemento(p_id uuid, p jsonb)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_clase public.clase_elemento;
begin
  perform public.exigir_supervisor();
  select clase into v_clase from public.elementos_red where id = p_id and eliminado_en is null;
  if v_clase is null then
    raise exception 'El elemento no existe' using errcode = 'P0002';
  end if;

  update public.elementos_red set
    codigo = upper(public.jtxt(p, 'codigo')),
    tipo_codigo = coalesce(public.jtxt(p, 'tipo_codigo'), tipo_codigo),
    nombre = public.jtxt(p, 'nombre'),
    direccion = public.jtxt(p, 'direccion'),
    comuna_id = public.jtxt(p, 'comuna_id')::int,
    sector = public.jtxt(p, 'sector'),
    estado = coalesce(public.jtxt(p, 'estado')::public.estado_elemento, estado),
    fecha_instalacion = public.jtxt(p, 'fecha_instalacion')::date,
    observaciones = public.jtxt(p, 'observaciones')
  where id = p_id;

  if p ? 'detalle' then
    perform public.guardar_detalle_elemento(p_id, v_clase, p -> 'detalle', false);
  end if;
end;
$$;

-- Mueve un elemento y arrastra los extremos de los cables que nacen o
-- terminan en él, para que el mapa siga mostrándolos conectados.
create or replace function public.mover_elemento(p_id uuid, p_lng float8, p_lat float8)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  c record;
begin
  perform public.exigir_supervisor();
  update public.elementos_red set ubicacion = public.punto_desde(p_lng, p_lat)
  where id = p_id and eliminado_en is null;
  if not found then
    raise exception 'El elemento no existe' using errcode = 'P0002';
  end if;

  for c in
    select id, trazado, origen_id, destino_id from public.cables
    where eliminado_en is null and (origen_id = p_id or destino_id = p_id)
  loop
    update public.cables
    set trazado = public.linea_desde(public.ajustar_extremos(public.coordenadas_de(c.trazado), c.origen_id, c.destino_id))
    where id = c.id;
  end loop;
end;
$$;

-- Baja lógica, solo si nada depende del elemento.
create or replace function public.eliminar_elemento(p_id uuid)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_clase public.clase_elemento;
  v_lista text;
begin
  perform public.exigir_supervisor();
  select clase into v_clase from public.elementos_red where id = p_id and eliminado_en is null for update;
  if v_clase is null then
    raise exception 'El elemento no existe' using errcode = 'P0002';
  end if;

  if v_clase = 'nap' and exists (
    select 1 from public.nap_puertos where nap_id = p_id and estado in ('ocupado', 'reservado')
  ) then
    raise exception 'La NAP tiene puertos ocupados o reservados; libérelos antes de eliminarla' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.conexiones
    where eliminado_en is null and estado <> 'retirado'
      and (elemento_id = p_id
           or olt_puerto_pon_id in (select id from public.olt_puertos_pon where olt_id = p_id))
  ) then
    raise exception 'El elemento tiene conexiones registradas; elimínelas antes' using errcode = 'P0001';
  end if;

  select string_agg(codigo, ', ' order by codigo) into v_lista
  from public.cables
  where eliminado_en is null and (origen_id = p_id or destino_id = p_id);
  if v_lista is not null then
    raise exception 'Hay cables que nacen o terminan en este elemento: %', v_lista using errcode = 'P0001';
  end if;

  select string_agg(c.codigo, ', ' order by c.codigo) into v_lista
  from public.cable_soportes s join public.cables c on c.id = s.cable_id
  where s.elemento_id = p_id and c.eliminado_en is null;
  if v_lista is not null then
    raise exception 'Hay cables que pasan por este elemento: %', v_lista using errcode = 'P0001';
  end if;

  update public.elementos_red set eliminado_en = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Cables
-- ---------------------------------------------------------------------

-- p: {codigo, nombre_tramo, tipo, modelo_cable_id, cantidad_fibras, origen_id, destino_id,
--     coordenadas: [[lng,lat],...], longitud_declarada_m, estado, fecha_instalacion, observaciones}
-- Si se indica origen o destino, el extremo del trazado se ubica exactamente sobre ese elemento.
create or replace function public.crear_cable(p jsonb)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_modelo int := public.jtxt(p, 'modelo_cable_id')::int;
  v_fibras int := public.jtxt(p, 'cantidad_fibras')::int;
  v_origen uuid := public.jtxt(p, 'origen_id')::uuid;
  v_destino uuid := public.jtxt(p, 'destino_id')::uuid;
  v_id uuid;
begin
  perform public.exigir_supervisor();
  if v_fibras is null and v_modelo is not null then
    select cantidad_fibras into v_fibras from public.modelos_cable where id = v_modelo;
  end if;
  if v_fibras is null then
    raise exception 'Indique la cantidad de fibras o el modelo del cable' using errcode = '23502';
  end if;

  insert into public.cables (codigo, nombre_tramo, tipo, modelo_cable_id, cantidad_fibras, origen_id, destino_id,
                             trazado, longitud_declarada_m, estado, fecha_instalacion, observaciones)
  values (
    upper(public.jtxt(p, 'codigo')),
    public.jtxt(p, 'nombre_tramo'),
    public.jtxt(p, 'tipo')::public.tipo_cable,
    v_modelo, v_fibras, v_origen, v_destino,
    public.linea_desde(public.ajustar_extremos(p -> 'coordenadas', v_origen, v_destino)),
    public.jtxt(p, 'longitud_declarada_m')::numeric,
    coalesce(public.jtxt(p, 'estado'), 'operativo')::public.estado_elemento,
    public.jtxt(p, 'fecha_instalacion')::date,
    public.jtxt(p, 'observaciones')
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Actualiza datos del cable. Si p trae "coordenadas", reemplaza el trazado.
create or replace function public.actualizar_cable(p_id uuid, p jsonb)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_actual public.cables%rowtype;
  v_origen uuid;
  v_destino uuid;
  v_coord jsonb;
begin
  perform public.exigir_supervisor();
  select * into v_actual from public.cables where id = p_id and eliminado_en is null for update;
  if v_actual.id is null then
    raise exception 'El cable no existe' using errcode = 'P0002';
  end if;

  v_origen := case when p ? 'origen_id' then public.jtxt(p, 'origen_id')::uuid else v_actual.origen_id end;
  v_destino := case when p ? 'destino_id' then public.jtxt(p, 'destino_id')::uuid else v_actual.destino_id end;
  v_coord := coalesce(p -> 'coordenadas', public.coordenadas_de(v_actual.trazado));

  update public.cables set
    codigo = coalesce(upper(public.jtxt(p, 'codigo')), codigo),
    nombre_tramo = case when p ? 'nombre_tramo' then public.jtxt(p, 'nombre_tramo') else nombre_tramo end,
    tipo = coalesce(public.jtxt(p, 'tipo')::public.tipo_cable, tipo),
    modelo_cable_id = case when p ? 'modelo_cable_id' then public.jtxt(p, 'modelo_cable_id')::int else modelo_cable_id end,
    cantidad_fibras = coalesce(public.jtxt(p, 'cantidad_fibras')::int, cantidad_fibras),
    origen_id = v_origen,
    destino_id = v_destino,
    trazado = public.linea_desde(public.ajustar_extremos(v_coord, v_origen, v_destino)),
    longitud_declarada_m = case when p ? 'longitud_declarada_m'
                                then public.jtxt(p, 'longitud_declarada_m')::numeric else longitud_declarada_m end,
    estado = coalesce(public.jtxt(p, 'estado')::public.estado_elemento, estado),
    fecha_instalacion = case when p ? 'fecha_instalacion'
                             then public.jtxt(p, 'fecha_instalacion')::date else fecha_instalacion end,
    observaciones = case when p ? 'observaciones' then public.jtxt(p, 'observaciones') else observaciones end
  where id = p_id;
end;
$$;

create or replace function public.eliminar_cable(p_id uuid)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.exigir_supervisor();
  if not exists (select 1 from public.cables where id = p_id and eliminado_en is null) then
    raise exception 'El cable no existe' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.conexiones x
    join public.cable_hilos h on h.id in (x.hilo_origen_id, x.hilo_destino_id)
    where h.cable_id = p_id and x.eliminado_en is null and x.estado <> 'retirado'
  ) then
    raise exception 'El cable tiene hilos con conexiones registradas; elimínelas antes' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.clientes
    where acometida_cable_id = p_id and estado <> 'retirado' and eliminado_en is null
  ) then
    raise exception 'El cable es la acometida de un cliente vigente' using errcode = 'P0001';
  end if;
  update public.cables set eliminado_en = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Búsqueda y fichas
-- ---------------------------------------------------------------------

-- Busca elementos, cables y clientes (estos solo si el rol los puede ver).
create or replace function public.buscar_red(p_texto text, p_limite int default 20)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  t text := btrim(coalesce(p_texto, ''));
  v_rut text := public.rut_normalizar(p_texto);
  r jsonb;
begin
  if length(t) < 2 then
    return '[]'::jsonb;
  end if;
  t := '%' || replace(replace(t, '%', ''), '_', '') || '%';

  select coalesce(jsonb_agg(x order by x ->> 'orden', x ->> 'titulo'), '[]'::jsonb) into r
  from (
    (select jsonb_build_object('orden', '1', 'tipo', 'elemento', 'id', e.id, 'clase', e.clase,
              'titulo', e.codigo, 'detalle', concat_ws(' · ', tp.nombre, e.nombre, e.direccion),
              'lng', st_x(e.ubicacion::geometry), 'lat', st_y(e.ubicacion::geometry)) as x
     from public.elementos_red e join public.tipos_elemento tp on tp.codigo = e.tipo_codigo
     where e.eliminado_en is null
       and (e.codigo ilike t or e.nombre ilike t or e.direccion ilike t or e.sector ilike t)
     order by e.codigo limit p_limite)
    union all
    (select jsonb_build_object('orden', '2', 'tipo', 'cable', 'id', c.id, 'clase', c.tipo,
              'titulo', c.codigo, 'detalle', concat_ws(' · ', 'Cable ' || c.tipo, c.nombre_tramo),
              'lng', (public.coordenadas_de(c.trazado) #>> '{0,0}')::float8,
              'lat', (public.coordenadas_de(c.trazado) #>> '{0,1}')::float8)
     from public.cables c
     where c.eliminado_en is null and (c.codigo ilike t or c.nombre_tramo ilike t)
     order by c.codigo limit p_limite)
    union all
    (select jsonb_build_object('orden', '3', 'tipo', 'cliente', 'id', k.id, 'clase', 'cliente',
              'titulo', k.nombre, 'detalle', concat_ws(' · ', k.codigo, k.direccion_calle || ' ' || coalesce(k.direccion_numero, '')),
              'lng', st_x(k.ubicacion::geometry), 'lat', st_y(k.ubicacion::geometry))
     from public.clientes k
     where k.eliminado_en is null
       and (k.nombre ilike t or k.codigo ilike t or k.direccion_calle ilike t or (v_rut is not null and k.rut = v_rut))
     order by k.nombre limit p_limite)
  ) s;
  return r;
end;
$$;

-- Ficha completa de un elemento para el panel lateral del mapa.
create or replace function public.ficha_elemento(p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  e public.elementos_red%rowtype;
  r jsonb;
  v_detalle jsonb := '{}'::jsonb;
begin
  select * into e from public.elementos_red where id = p_id and eliminado_en is null;
  if e.id is null then
    return null;
  end if;

  v_detalle := case e.clase
    when 'nap'           then (select to_jsonb(x) - 'elemento_id' - 'clase' from public.nap x where x.elemento_id = p_id)
    when 'olt'           then (select to_jsonb(x) - 'elemento_id' - 'clase' from public.olts x where x.elemento_id = p_id)
    when 'poste'         then (select to_jsonb(x) - 'elemento_id' - 'clase' from public.postes x where x.elemento_id = p_id)
    when 'camara'        then (select to_jsonb(x) - 'elemento_id' - 'clase' from public.camaras x where x.elemento_id = p_id)
    when 'caja_empalme'  then (select to_jsonb(x) - 'elemento_id' - 'clase' from public.cajas_empalme x where x.elemento_id = p_id)
    when 'splitter'      then (select to_jsonb(x) - 'elemento_id' - 'clase' from public.splitters x where x.elemento_id = p_id)
    when 'gabinete'      then (select to_jsonb(x) - 'elemento_id' - 'clase' from public.gabinetes x where x.elemento_id = p_id)
    when 'punto_ingreso' then (select to_jsonb(x) - 'elemento_id' - 'clase' from public.puntos_ingreso x where x.elemento_id = p_id)
    else '{}'::jsonb
  end;

  r := jsonb_build_object(
    'id', e.id, 'codigo', e.codigo, 'clase', e.clase, 'tipo_codigo', e.tipo_codigo,
    'tipo_nombre', (select nombre from public.tipos_elemento where codigo = e.tipo_codigo),
    'nombre', e.nombre, 'direccion', e.direccion, 'comuna_id', e.comuna_id,
    'comuna', (select nombre from public.comunas where id = e.comuna_id),
    'sector', e.sector, 'estado', e.estado, 'fecha_instalacion', e.fecha_instalacion,
    'observaciones', e.observaciones, 'es_demo', e.es_demo,
    'lng', st_x(e.ubicacion::geometry), 'lat', st_y(e.ubicacion::geometry),
    'creado_en', e.creado_en, 'actualizado_en', e.actualizado_en,
    'detalle', coalesce(v_detalle, '{}'::jsonb),
    'cables', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'codigo', c.codigo, 'tipo', c.tipo,
                                          'extremo', case when c.origen_id = p_id then 'origen' else 'destino' end)
                       order by c.codigo)
      from public.cables c
      where c.eliminado_en is null and (c.origen_id = p_id or c.destino_id = p_id)), '[]'::jsonb)
  );

  if e.clase = 'nap' then
    r := r || jsonb_build_object(
      'ratio', (select rs.ratio from public.nap n join public.ratios_splitter rs on rs.id = n.ratio_splitter_id
                where n.elemento_id = p_id),
      'puertos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'numero', p.numero, 'estado', p.estado, 'observaciones', p.observaciones,
          'cliente', (select jsonb_build_object('id', k.id, 'codigo', k.codigo, 'nombre', k.nombre, 'estado', k.estado)
                      from public.clientes k
                      where k.nap_puerto_id = p.id and k.estado <> 'retirado' and k.eliminado_en is null
                      limit 1)
        ) order by p.numero)
        from public.nap_puertos p where p.nap_id = p_id), '[]'::jsonb),
      -- Alimentación registrada: hilo del cable y, si existe, el puerto PON que lo inyecta.
      'alimentacion', (
        select jsonb_build_object(
          'conexion_id', x.id, 'confirmada', x.confirmada,
          'cable_id', c.id, 'cable_codigo', c.codigo,
          'hilo', h.numero, 'color', h.color, 'tubo', h.tubo,
          'olt_codigo', (select oe.codigo from public.conexiones i
                         join public.olt_puertos_pon pp on pp.id = i.olt_puerto_pon_id
                         join public.elementos_red oe on oe.id = pp.olt_id
                         where i.tipo = 'inyeccion_olt' and i.hilo_destino_id = h.id
                           and i.eliminado_en is null and i.estado <> 'retirado' limit 1),
          'puerto_pon', (select pp.etiqueta from public.conexiones i
                         join public.olt_puertos_pon pp on pp.id = i.olt_puerto_pon_id
                         where i.tipo = 'inyeccion_olt' and i.hilo_destino_id = h.id
                           and i.eliminado_en is null and i.estado <> 'retirado' limit 1))
        from public.conexiones x
        join public.cable_hilos h on h.id = x.hilo_origen_id
        join public.cables c on c.id = h.cable_id
        where x.tipo = 'alimentacion_nap' and x.elemento_id = p_id
          and x.eliminado_en is null and x.estado <> 'retirado'
        limit 1)
    );
  elsif e.clase = 'olt' then
    r := r || jsonb_build_object('puertos_pon', coalesce((
      select jsonb_agg(jsonb_build_object('id', pp.id, 'slot', pp.slot, 'puerto', pp.puerto,
                                          'etiqueta', pp.etiqueta, 'activo', pp.activo,
                                          'hilos', (select count(*) from public.conexiones i
                                                    where i.olt_puerto_pon_id = pp.id and i.eliminado_en is null
                                                      and i.estado <> 'retirado'))
                       order by pp.slot, pp.puerto)
      from public.olt_puertos_pon pp where pp.olt_id = p_id), '[]'::jsonb));
  end if;

  return r;
end;
$$;

-- Ficha de un cable: datos, extremos y estado de sus hilos.
create or replace function public.ficha_cable(p_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id, 'codigo', c.codigo, 'nombre_tramo', c.nombre_tramo, 'tipo', c.tipo, 'estado', c.estado,
    'modelo_cable_id', c.modelo_cable_id,
    'modelo', (select nombre from public.modelos_cable where id = c.modelo_cable_id),
    'cantidad_fibras', c.cantidad_fibras,
    'longitud_mapa_m', c.longitud_mapa_m, 'longitud_declarada_m', c.longitud_declarada_m,
    'fecha_instalacion', c.fecha_instalacion, 'observaciones', c.observaciones, 'es_demo', c.es_demo,
    'origen', (select jsonb_build_object('id', e.id, 'codigo', e.codigo, 'clase', e.clase)
               from public.elementos_red e where e.id = c.origen_id),
    'destino', (select jsonb_build_object('id', e.id, 'codigo', e.codigo, 'clase', e.clase)
                from public.elementos_red e where e.id = c.destino_id),
    'coordenadas', public.coordenadas_de(c.trazado),
    'hilos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'numero', h.numero, 'tubo', h.tubo, 'color', h.color, 'estado', h.estado,
        'nap', (select jsonb_build_object('id', e.id, 'codigo', e.codigo)
                from public.conexiones x join public.elementos_red e on e.id = x.elemento_id
                where x.tipo = 'alimentacion_nap' and x.hilo_origen_id = h.id
                  and x.eliminado_en is null and x.estado <> 'retirado' limit 1)
      ) order by h.numero)
      from public.cable_hilos h where h.cable_id = c.id), '[]'::jsonb)
  )
  from public.cables c
  where c.id = p_id and c.eliminado_en is null;
$$;

-- ---------------------------------------------------------------------
-- Privilegios: solo usuarios autenticados
-- ---------------------------------------------------------------------
revoke execute on function public.tg_nap_puerto_guardia() from public, anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.conf_numero(text, numeric)', 'public.punto_desde(float8, float8)', 'public.linea_desde(jsonb)',
    'public.coordenadas_de(geography)', 'public.ajustar_extremos(jsonb, uuid, uuid)', 'public.exigir_supervisor()',
    'public.jtxt(jsonb, text)',
    'public.elementos_en_zona(float8, float8, float8, float8, public.clase_elemento[], public.estado_elemento[], text)',
    'public.mapa_elementos(float8, float8, float8, float8, int, public.clase_elemento[], public.estado_elemento[], text)',
    'public.mapa_cables(float8, float8, float8, float8, public.tipo_cable[], public.estado_elemento[])',
    'public.mapa_zonas(float8, float8, float8, float8)',
    'public.guardar_detalle_elemento(uuid, public.clase_elemento, jsonb, boolean)',
    'public.crear_elemento(jsonb)', 'public.actualizar_elemento(uuid, jsonb)',
    'public.mover_elemento(uuid, float8, float8)', 'public.eliminar_elemento(uuid)',
    'public.crear_cable(jsonb)', 'public.actualizar_cable(uuid, jsonb)', 'public.eliminar_cable(uuid)',
    'public.buscar_red(text, int)', 'public.ficha_elemento(uuid)', 'public.ficha_cable(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
