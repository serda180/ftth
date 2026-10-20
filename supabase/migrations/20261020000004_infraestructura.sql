-- =====================================================================
-- 0004 · Infraestructura de red
-- =====================================================================
-- Modelo de herencia por tablas:
--   elementos_red (supertipo, datos comunes y ubicación)
--     ├─ olts            ├─ postes         ├─ splitters
--     ├─ nap             ├─ camaras        ├─ gabinetes
--     └─ cajas_empalme   └─ puntos_ingreso
-- Cada tabla de detalle referencia (id, clase) del supertipo, de modo que
-- una fila de "nap" solo puede colgar de un elemento de clase nap.
-- Arquitectura de esta red: OLT (puerto PON) → troncal (hilo) → NAP con
-- splitter interno → acometida → cliente.

create type public.estado_elemento as enum (
  'planificado', 'en_construccion', 'operativo', 'fuera_servicio', 'retirado'
);
create type public.estado_puerto as enum ('libre', 'reservado', 'ocupado', 'averiado');
create type public.estado_hilo as enum ('libre', 'en_uso', 'reservado', 'danado');
create type public.tipo_cable as enum ('troncal', 'distribucion', 'derivacion', 'acometida');
create type public.tipo_conexion as enum (
  'inyeccion_olt',          -- puerto PON de OLT → hilo de cable
  'alimentacion_nap',       -- hilo de cable → NAP (splitter interno)
  'empalme_hilos',          -- hilo → hilo (en caja de empalme)
  'alimentacion_splitter',  -- hilo → splitter independiente (uso futuro)
  'salida_splitter'         -- splitter independiente → hilo (uso futuro)
);

alter table public.tipos_elemento add constraint tipos_elemento_codigo_clase_key unique (codigo, clase);

-- ---------------------------------------------------------------------
-- Supertipo
-- ---------------------------------------------------------------------
create table public.elementos_red (
  id uuid primary key default gen_random_uuid(),
  codigo text not null check (codigo ~ '^[A-Za-z0-9._-]{2,40}$'),
  clase public.clase_elemento not null,
  tipo_codigo text not null,
  nombre text,
  ubicacion geography(Point, 4326) not null,
  direccion text,
  comuna_id int references public.comunas (id),
  sector text,
  estado public.estado_elemento not null default 'operativo',
  fecha_instalacion date,
  observaciones text,
  es_demo boolean not null default false,
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  unique (id, clase),
  foreign key (tipo_codigo, clase) references public.tipos_elemento (codigo, clase)
);
create unique index elementos_red_codigo_activo_key
  on public.elementos_red (upper(codigo)) where eliminado_en is null;
create index elementos_red_ubicacion_idx on public.elementos_red using gist (ubicacion);
create index elementos_red_clase_idx on public.elementos_red (clase) where eliminado_en is null;
create index elementos_red_busqueda_idx on public.elementos_red
  using gin ((coalesce(codigo, '') || ' ' || coalesce(nombre, '') || ' ' || coalesce(direccion, '')) gin_trgm_ops);
create trigger elementos_red_actualizado_en
  before update on public.elementos_red
  for each row execute function public.tg_actualizado_en();

-- ---------------------------------------------------------------------
-- Subtipos
-- ---------------------------------------------------------------------
create table public.olts (
  elemento_id uuid primary key,
  clase public.clase_elemento not null default 'olt' check (clase = 'olt'),
  marca text,
  modelo text,
  tecnologia text not null default 'GPON' check (tecnologia in ('GPON', 'XG-PON', 'XGS-PON', 'EPON')),
  numero_serie text,
  ip_gestion inet,
  foreign key (elemento_id, clase) references public.elementos_red (id, clase) on delete cascade
);

create table public.olt_puertos_pon (
  id uuid primary key default gen_random_uuid(),
  olt_id uuid not null references public.olts (elemento_id) on delete cascade,
  slot int not null default 0 check (slot >= 0),
  puerto int not null check (puerto >= 0),
  etiqueta text,
  activo boolean not null default true,
  unique (olt_id, slot, puerto)
);

create table public.nap (
  elemento_id uuid primary key,
  clase public.clase_elemento not null default 'nap' check (clase = 'nap'),
  ratio_splitter_id int not null references public.ratios_splitter (id),
  capacidad_puertos int not null check (capacidad_puertos between 1 and 128),
  modelo text,
  tecnico_responsable_id uuid references public.perfiles (id) on delete set null,
  foreign key (elemento_id, clase) references public.elementos_red (id, clase) on delete cascade
);

create table public.nap_puertos (
  id uuid primary key default gen_random_uuid(),
  nap_id uuid not null references public.nap (elemento_id) on delete cascade,
  numero int not null check (numero >= 1),
  estado public.estado_puerto not null default 'libre',
  observaciones text,
  actualizado_en timestamptz not null default now(),
  unique (nap_id, numero)
);
create index nap_puertos_estado_idx on public.nap_puertos (nap_id, estado);
create trigger nap_puertos_actualizado_en
  before update on public.nap_puertos
  for each row execute function public.tg_actualizado_en();

create table public.postes (
  elemento_id uuid primary key,
  clase public.clase_elemento not null default 'poste' check (clase = 'poste'),
  material text check (material in ('hormigon', 'madera', 'metal', 'otro')),
  altura_m numeric(4,1) check (altura_m > 0),
  propietario text,           -- ej.: empresa eléctrica dueña del poste
  numero_placa text,          -- identificación del propietario
  foreign key (elemento_id, clase) references public.elementos_red (id, clase) on delete cascade
);

create table public.camaras (
  elemento_id uuid primary key,
  clase public.clase_elemento not null default 'camara' check (clase = 'camara'),
  tipo text,
  dimensiones text,
  foreign key (elemento_id, clase) references public.elementos_red (id, clase) on delete cascade
);

create table public.cajas_empalme (
  elemento_id uuid primary key,
  clase public.clase_elemento not null default 'caja_empalme' check (clase = 'caja_empalme'),
  modelo text,
  capacidad_empalmes int check (capacidad_empalmes > 0),
  foreign key (elemento_id, clase) references public.elementos_red (id, clase) on delete cascade
);

create table public.splitters (
  elemento_id uuid primary key,
  clase public.clase_elemento not null default 'splitter' check (clase = 'splitter'),
  ratio_splitter_id int not null references public.ratios_splitter (id),
  foreign key (elemento_id, clase) references public.elementos_red (id, clase) on delete cascade
);

create table public.gabinetes (
  elemento_id uuid primary key,
  clase public.clase_elemento not null default 'gabinete' check (clase = 'gabinete'),
  descripcion text,
  foreign key (elemento_id, clase) references public.elementos_red (id, clase) on delete cascade
);

create table public.puntos_ingreso (
  elemento_id uuid primary key,
  clase public.clase_elemento not null default 'punto_ingreso' check (clase = 'punto_ingreso'),
  edificio text,
  pisos int check (pisos > 0),
  contacto_administracion text,
  foreign key (elemento_id, clase) references public.elementos_red (id, clase) on delete cascade
);

-- ---------------------------------------------------------------------
-- Puertos de NAP: se generan y ajustan solos según la capacidad
-- ---------------------------------------------------------------------
create or replace function public.tg_nap_sincronizar_puertos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.nap_puertos (nap_id, numero)
    select new.elemento_id, g from generate_series(1, new.capacidad_puertos) g;
    return new;
  end if;

  if new.capacidad_puertos < old.capacidad_puertos then
    if exists (
      select 1 from public.nap_puertos
      where nap_id = new.elemento_id and numero > new.capacidad_puertos and estado <> 'libre'
    ) then
      raise exception 'No se puede reducir la capacidad: hay puertos sobre el % ocupados, reservados o averiados',
        new.capacidad_puertos using errcode = 'P0001';
    end if;
    delete from public.nap_puertos
    where nap_id = new.elemento_id and numero > new.capacidad_puertos;
  elsif new.capacidad_puertos > old.capacidad_puertos then
    insert into public.nap_puertos (nap_id, numero)
    select new.elemento_id, g
    from generate_series(old.capacidad_puertos + 1, new.capacidad_puertos) g;
  end if;
  return new;
end;
$$;

create trigger nap_generar_puertos
  after insert on public.nap
  for each row execute function public.tg_nap_sincronizar_puertos();

create trigger nap_ajustar_puertos
  after update of capacidad_puertos on public.nap
  for each row when (new.capacidad_puertos <> old.capacidad_puertos)
  execute function public.tg_nap_sincronizar_puertos();

-- ---------------------------------------------------------------------
-- Cables
-- ---------------------------------------------------------------------
create table public.cables (
  id uuid primary key default gen_random_uuid(),
  codigo text not null check (codigo ~ '^[A-Za-z0-9._-]{2,40}$'),
  nombre_tramo text,
  tipo public.tipo_cable not null,
  modelo_cable_id int references public.modelos_cable (id),
  cantidad_fibras int not null check (cantidad_fibras between 1 and 864),
  origen_id uuid references public.elementos_red (id),
  destino_id uuid references public.elementos_red (id),
  trazado geography(LineString, 4326) not null,
  -- Longitud geodésica medida sobre el mapa, en metros.
  longitud_mapa_m numeric(10,1) generated always as (round(st_length(trazado)::numeric, 1)) stored,
  -- Longitud real o declarada (incluye reservas y flojas), en metros.
  longitud_declarada_m numeric(10,1) check (longitud_declarada_m >= 0),
  estado public.estado_elemento not null default 'operativo',
  fecha_instalacion date,
  observaciones text,
  es_demo boolean not null default false,
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  check (origen_id is null or destino_id is null or origen_id <> destino_id)
);
create unique index cables_codigo_activo_key
  on public.cables (upper(codigo)) where eliminado_en is null;
create index cables_trazado_idx on public.cables using gist (trazado);
create index cables_tipo_idx on public.cables (tipo) where eliminado_en is null;
create index cables_origen_idx on public.cables (origen_id);
create index cables_destino_idx on public.cables (destino_id);
create trigger cables_actualizado_en
  before update on public.cables
  for each row execute function public.tg_actualizado_en();

-- Hilos (fibras) de cada cable, con color según TIA-598.
create table public.cable_hilos (
  id uuid primary key default gen_random_uuid(),
  cable_id uuid not null references public.cables (id) on delete cascade,
  numero int not null check (numero >= 1),
  tubo int not null check (tubo >= 1),
  color text not null,
  estado public.estado_hilo not null default 'libre',
  observaciones text,
  actualizado_en timestamptz not null default now(),
  unique (cable_id, numero)
);
create index cable_hilos_estado_idx on public.cable_hilos (cable_id, estado);
create trigger cable_hilos_actualizado_en
  before update on public.cable_hilos
  for each row execute function public.tg_actualizado_en();

create or replace function public.color_fibra_tia598(posicion int)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['Azul', 'Naranjo', 'Verde', 'Café', 'Gris', 'Blanco',
                'Rojo', 'Negro', 'Amarillo', 'Violeta', 'Rosado', 'Aqua'])[((posicion - 1) % 12) + 1];
$$;

create or replace function public.tg_cable_sincronizar_hilos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  por_tubo int := 12;
  desde int;
begin
  if new.modelo_cable_id is not null then
    select fibras_por_tubo into por_tubo from public.modelos_cable where id = new.modelo_cable_id;
  end if;

  if tg_op = 'INSERT' then
    desde := 1;
  else
    if new.cantidad_fibras < old.cantidad_fibras then
      if exists (
        select 1 from public.cable_hilos
        where cable_id = new.id and numero > new.cantidad_fibras and estado <> 'libre'
      ) then
        raise exception 'No se puede reducir la cantidad de fibras: hay hilos sobre el % en uso, reservados o dañados',
          new.cantidad_fibras using errcode = 'P0001';
      end if;
      delete from public.cable_hilos where cable_id = new.id and numero > new.cantidad_fibras;
      return new;
    end if;
    desde := old.cantidad_fibras + 1;
  end if;

  insert into public.cable_hilos (cable_id, numero, tubo, color)
  select new.id, g, ((g - 1) / por_tubo) + 1, public.color_fibra_tia598(((g - 1) % por_tubo) + 1)
  from generate_series(desde, new.cantidad_fibras) g;
  return new;
end;
$$;

create trigger cable_generar_hilos
  after insert on public.cables
  for each row execute function public.tg_cable_sincronizar_hilos();

create trigger cable_ajustar_hilos
  after update of cantidad_fibras on public.cables
  for each row when (new.cantidad_fibras <> old.cantidad_fibras)
  execute function public.tg_cable_sincronizar_hilos();

-- Postes, cámaras u otros elementos por los que pasa un cable, en orden.
create table public.cable_soportes (
  cable_id uuid not null references public.cables (id) on delete cascade,
  orden int not null check (orden >= 1),
  elemento_id uuid not null references public.elementos_red (id),
  primary key (cable_id, orden),
  unique (cable_id, elemento_id)
);
create index cable_soportes_elemento_idx on public.cable_soportes (elemento_id);

-- ---------------------------------------------------------------------
-- Conexiones explícitas (base de la topología lógica)
-- El enlace puerto de NAP → cliente se registra en clientes.nap_puerto_id.
-- ---------------------------------------------------------------------
create table public.conexiones (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_conexion not null,
  olt_puerto_pon_id uuid references public.olt_puertos_pon (id),
  hilo_origen_id uuid references public.cable_hilos (id),
  hilo_destino_id uuid references public.cable_hilos (id),
  elemento_id uuid references public.elementos_red (id),
  punto geography(Point, 4326),   -- punto de derivación o empalme en el mapa
  confirmada boolean not null default false,  -- verificada en terreno
  estado public.estado_elemento not null default 'operativo',
  fecha date,
  observaciones text,
  es_demo boolean not null default false,
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  constraint conexiones_campos_por_tipo check (
    case tipo
      when 'inyeccion_olt'         then olt_puerto_pon_id is not null and hilo_destino_id is not null
                                        and hilo_origen_id is null and elemento_id is null
      when 'alimentacion_nap'      then hilo_origen_id is not null and elemento_id is not null
                                        and olt_puerto_pon_id is null and hilo_destino_id is null
      when 'empalme_hilos'         then hilo_origen_id is not null and hilo_destino_id is not null
                                        and olt_puerto_pon_id is null and hilo_origen_id <> hilo_destino_id
      when 'alimentacion_splitter' then hilo_origen_id is not null and elemento_id is not null
                                        and olt_puerto_pon_id is null and hilo_destino_id is null
      when 'salida_splitter'       then elemento_id is not null and hilo_destino_id is not null
                                        and olt_puerto_pon_id is null and hilo_origen_id is null
    end
  )
);
-- Un hilo alimenta como máximo una NAP; una NAP se alimenta de un solo hilo;
-- un hilo recibe señal de un solo puerto PON.
create unique index conexiones_hilo_alimenta_una_nap
  on public.conexiones (hilo_origen_id)
  where tipo = 'alimentacion_nap' and eliminado_en is null and estado <> 'retirado';
create unique index conexiones_nap_un_hilo
  on public.conexiones (elemento_id)
  where tipo = 'alimentacion_nap' and eliminado_en is null and estado <> 'retirado';
create unique index conexiones_hilo_una_inyeccion
  on public.conexiones (hilo_destino_id)
  where tipo = 'inyeccion_olt' and eliminado_en is null and estado <> 'retirado';
create index conexiones_hilo_destino_idx on public.conexiones (hilo_destino_id);
create index conexiones_elemento_idx on public.conexiones (elemento_id);
create trigger conexiones_actualizado_en
  before update on public.conexiones
  for each row execute function public.tg_actualizado_en();

-- La conexión debe apuntar a un elemento de la clase correcta.
create or replace function public.tg_conexion_validar_elemento()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_clase public.clase_elemento;
begin
  if new.elemento_id is null then
    return new;
  end if;
  select clase into v_clase from public.elementos_red where id = new.elemento_id;
  if new.tipo = 'alimentacion_nap' and v_clase <> 'nap' then
    raise exception 'Una conexión de alimentación de NAP debe apuntar a una NAP' using errcode = '23514';
  elsif new.tipo in ('alimentacion_splitter', 'salida_splitter') and v_clase <> 'splitter' then
    raise exception 'La conexión debe apuntar a un splitter' using errcode = '23514';
  elsif new.tipo = 'empalme_hilos' and v_clase not in ('caja_empalme', 'gabinete', 'camara', 'poste', 'otro') then
    raise exception 'Un empalme debe ubicarse en una caja de empalme, gabinete, cámara, poste u otro punto' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger conexiones_validar_elemento
  before insert or update on public.conexiones
  for each row execute function public.tg_conexion_validar_elemento();

-- ---------------------------------------------------------------------
-- Zonas de cobertura
-- ---------------------------------------------------------------------
create table public.zonas_cobertura (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  area geography(Polygon, 4326) not null,
  estado public.estado_elemento not null default 'operativo',
  color text not null default '#0891b2' check (color ~ '^#[0-9a-fA-F]{6}$'),
  descripcion text,
  es_demo boolean not null default false,
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz
);
create index zonas_cobertura_area_idx on public.zonas_cobertura using gist (area);
create trigger zonas_cobertura_actualizado_en
  before update on public.zonas_cobertura
  for each row execute function public.tg_actualizado_en();
