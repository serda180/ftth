-- =====================================================================
-- 0006 · Órdenes de trabajo
-- =====================================================================

create type public.tipo_orden as enum (
  'instalacion', 'reparacion', 'mantenimiento', 'cambio_domicilio', 'desconexion', 'retiro_equipos'
);
create type public.estado_orden as enum (
  'pendiente', 'asignada', 'en_camino', 'en_ejecucion', 'completada', 'cancelada'
);
create type public.prioridad_orden as enum ('baja', 'media', 'alta', 'urgente');

create table public.ordenes_trabajo (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  tipo public.tipo_orden not null,
  prioridad public.prioridad_orden not null default 'media',
  estado public.estado_orden not null default 'pendiente',
  cliente_id uuid references public.clientes (id),
  solicitud_id uuid references public.solicitudes (id),
  direccion text,
  comuna_id int references public.comunas (id),
  ubicacion geography(Point, 4326),
  tecnico_id uuid references public.perfiles (id) on delete set null,
  fecha_programada timestamptz,
  descripcion text not null check (length(btrim(descripcion)) >= 3),
  potencia_ont_dbm numeric(5,2) check (potencia_ont_dbm between -50 and 10),
  potencia_nap_dbm numeric(5,2) check (potencia_nap_dbm between -50 and 10),
  resultado_pruebas text,
  conformidad_cliente boolean,
  observaciones text,
  iniciada_en timestamptz,
  cerrada_en timestamptz,
  ubicacion_cierre geography(Point, 4326),
  es_demo boolean not null default false,
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  constraint ordenes_destino_requerido check (cliente_id is not null or solicitud_id is not null),
  constraint ordenes_tecnico_requerido
    check (estado in ('pendiente', 'cancelada') or tecnico_id is not null)
);
create index ordenes_tecnico_idx on public.ordenes_trabajo (tecnico_id, estado) where eliminado_en is null;
create index ordenes_estado_idx on public.ordenes_trabajo (estado) where eliminado_en is null;
create index ordenes_cliente_idx on public.ordenes_trabajo (cliente_id);
create index ordenes_solicitud_idx on public.ordenes_trabajo (solicitud_id);
create index ordenes_fecha_idx on public.ordenes_trabajo (fecha_programada);
create index ordenes_ubicacion_idx on public.ordenes_trabajo using gist (ubicacion);

-- Número correlativo y marcas de tiempo según el estado.
create or replace function public.tg_orden_preparar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.numero is null then
    new.numero := public.siguiente_correlativo('OT');
  end if;
  if new.estado = 'en_ejecucion' and new.iniciada_en is null then
    new.iniciada_en := now();
  end if;
  if new.estado in ('completada', 'cancelada') and new.cerrada_en is null then
    new.cerrada_en := now();
  elsif new.estado not in ('completada', 'cancelada') then
    new.cerrada_en := null;
  end if;
  return new;
end;
$$;

create trigger ordenes_preparar
  before insert or update on public.ordenes_trabajo
  for each row execute function public.tg_orden_preparar();
create trigger ordenes_actualizado_en
  before update on public.ordenes_trabajo
  for each row execute function public.tg_actualizado_en();

-- Un técnico (sin otro rol de gestión) solo puede avanzar sus órdenes y
-- registrar el resultado. No puede reasignarlas, cambiar el cliente,
-- la prioridad ni la fecha, ni cancelarlas.
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
  if (select auth.uid()) is null
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

create trigger ordenes_guardia_tecnico
  before update on public.ordenes_trabajo
  for each row execute function public.tg_orden_guardia_tecnico();
