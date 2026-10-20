-- =====================================================================
-- 0005 · Clientes y solicitudes de instalación
-- =====================================================================

create type public.estado_cliente as enum ('pendiente', 'activo', 'suspendido', 'retirado');
create type public.estado_solicitud as enum (
  'nueva', 'en_factibilidad', 'factible', 'no_factible', 'pendiente_info',
  'puerto_reservado', 'orden_generada', 'instalada', 'activada', 'cancelada'
);

create sequence public.clientes_codigo_seq;

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique
    default ('CLI-' || lpad(nextval('public.clientes_codigo_seq')::text, 6, '0')),
  nombre text not null check (length(btrim(nombre)) >= 2),
  rut text not null check (public.rut_es_valido(rut)),
  telefono text check (telefono is null or public.telefono_es_valido(telefono)),
  whatsapp text check (whatsapp is null or public.telefono_es_valido(whatsapp)),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  direccion_calle text not null check (length(btrim(direccion_calle)) >= 2),
  direccion_numero text,
  direccion_depto text,
  comuna_id int not null references public.comunas (id),
  referencia text,
  ubicacion geography(Point, 4326),
  plan_id int references public.planes (id),
  precio_mensual_clp int check (precio_mensual_clp >= 0),
  fecha_contratacion date,
  numero_contrato text,
  estado public.estado_cliente not null default 'pendiente',
  nap_puerto_id uuid references public.nap_puertos (id),
  acometida_cable_id uuid references public.cables (id),
  numero_serie_ont text,
  observaciones text,
  es_demo boolean not null default false,
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  constraint clientes_activo_requiere_plan check (estado <> 'activo' or plan_id is not null)
);

-- Un puerto atiende a un solo cliente vigente.
create unique index clientes_puerto_vigente_key
  on public.clientes (nap_puerto_id)
  where nap_puerto_id is not null and estado <> 'retirado' and eliminado_en is null;
create unique index clientes_contrato_key
  on public.clientes (numero_contrato)
  where numero_contrato is not null and eliminado_en is null;
create index clientes_rut_idx on public.clientes (rut);
create index clientes_estado_idx on public.clientes (estado) where eliminado_en is null;
create index clientes_comuna_idx on public.clientes (comuna_id);
create index clientes_ubicacion_idx on public.clientes using gist (ubicacion);
create index clientes_busqueda_idx on public.clientes using gin (
  (codigo || ' ' || nombre || ' ' || rut || ' ' || direccion_calle || ' ' || coalesce(direccion_numero, ''))
  gin_trgm_ops
);

create or replace function public.tg_normalizar_contacto()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.telefono := public.telefono_normalizar(new.telefono);
  new.whatsapp := public.telefono_normalizar(new.whatsapp);
  if new.email is not null then
    new.email := nullif(lower(btrim(new.email)), '');
  end if;
  return new;
end;
$$;

create trigger clientes_normalizar_rut
  before insert or update of rut on public.clientes
  for each row execute function public.tg_normalizar_rut();
create trigger clientes_normalizar_contacto
  before insert or update on public.clientes
  for each row execute function public.tg_normalizar_contacto();
create trigger clientes_actualizado_en
  before update on public.clientes
  for each row execute function public.tg_actualizado_en();

-- ---------------------------------------------------------------------
-- Historial del cliente (se alimenta solo con los cambios relevantes;
-- también admite notas y visitas registradas a mano)
-- ---------------------------------------------------------------------
create table public.cliente_historial (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  tipo text not null check (tipo in (
    'creacion', 'cambio_estado', 'cambio_plan', 'cambio_precio', 'cambio_puerto',
    'instalacion', 'visita', 'nota'
  )),
  descripcion text not null,
  datos jsonb,
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now()
);
create index cliente_historial_cliente_idx on public.cliente_historial (cliente_id, creado_en desc);

create or replace function public.tg_cliente_historial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.cliente_historial (cliente_id, tipo, descripcion, datos)
    values (new.id, 'creacion', 'Cliente registrado con estado ' || new.estado,
            jsonb_build_object('estado', new.estado, 'plan_id', new.plan_id));
    return new;
  end if;

  if new.estado is distinct from old.estado then
    insert into public.cliente_historial (cliente_id, tipo, descripcion, datos)
    values (new.id, 'cambio_estado', 'Estado: ' || old.estado || ' → ' || new.estado,
            jsonb_build_object('anterior', old.estado, 'nuevo', new.estado));
  end if;
  if new.plan_id is distinct from old.plan_id then
    insert into public.cliente_historial (cliente_id, tipo, descripcion, datos)
    values (new.id, 'cambio_plan', 'Cambio de plan',
            jsonb_build_object('anterior', old.plan_id, 'nuevo', new.plan_id));
  end if;
  if new.precio_mensual_clp is distinct from old.precio_mensual_clp then
    insert into public.cliente_historial (cliente_id, tipo, descripcion, datos)
    values (new.id, 'cambio_precio', 'Cambio de precio mensual',
            jsonb_build_object('anterior', old.precio_mensual_clp, 'nuevo', new.precio_mensual_clp));
  end if;
  if new.nap_puerto_id is distinct from old.nap_puerto_id then
    insert into public.cliente_historial (cliente_id, tipo, descripcion, datos)
    values (new.id, 'cambio_puerto', 'Cambio de puerto de NAP',
            jsonb_build_object('anterior', old.nap_puerto_id, 'nuevo', new.nap_puerto_id));
  end if;
  return new;
end;
$$;

create trigger clientes_historial
  after insert or update on public.clientes
  for each row execute function public.tg_cliente_historial();

-- ---------------------------------------------------------------------
-- Solicitudes de instalación
-- ---------------------------------------------------------------------
create table public.solicitudes (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  estado public.estado_solicitud not null default 'nueva',
  canal text not null default 'telefono'
    check (canal in ('telefono', 'whatsapp', 'presencial', 'web', 'correo', 'otro')),
  nombre text not null check (length(btrim(nombre)) >= 2),
  rut text check (rut is null or public.rut_es_valido(rut)),
  telefono text check (telefono is null or public.telefono_es_valido(telefono)),
  whatsapp text check (whatsapp is null or public.telefono_es_valido(whatsapp)),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  direccion_calle text not null,
  direccion_numero text,
  direccion_depto text,
  comuna_id int not null references public.comunas (id),
  referencia text,
  ubicacion geography(Point, 4326),
  plan_id int references public.planes (id),
  cliente_id uuid references public.clientes (id),
  nap_id uuid references public.nap (elemento_id),
  puerto_reservado_id uuid references public.nap_puertos (id),
  reserva_vence_en timestamptz,
  factibilidad jsonb,            -- resultado del análisis al momento de evaluar
  motivo_decision text,
  evaluado_por uuid references public.perfiles (id) on delete set null,
  evaluado_en timestamptz,
  observaciones text,
  es_demo boolean not null default false,
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  constraint solicitudes_rechazo_con_motivo
    check (estado <> 'no_factible' or nullif(btrim(motivo_decision), '') is not null),
  constraint solicitudes_reserva_con_puerto
    check (estado <> 'puerto_reservado' or puerto_reservado_id is not null)
);
create unique index solicitudes_puerto_reservado_key
  on public.solicitudes (puerto_reservado_id)
  where puerto_reservado_id is not null
    and estado in ('puerto_reservado', 'orden_generada', 'instalada')
    and eliminado_en is null;
create index solicitudes_estado_idx on public.solicitudes (estado) where eliminado_en is null;
create index solicitudes_ubicacion_idx on public.solicitudes using gist (ubicacion);

create or replace function public.tg_solicitud_numero()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.numero is null then
    new.numero := public.siguiente_correlativo('SOL');
  end if;
  return new;
end;
$$;

create trigger solicitudes_numero
  before insert on public.solicitudes
  for each row execute function public.tg_solicitud_numero();
create trigger solicitudes_normalizar_rut
  before insert or update of rut on public.solicitudes
  for each row execute function public.tg_normalizar_rut();
create trigger solicitudes_normalizar_contacto
  before insert or update on public.solicitudes
  for each row execute function public.tg_normalizar_contacto();
create trigger solicitudes_actualizado_en
  before update on public.solicitudes
  for each row execute function public.tg_actualizado_en();
