-- =====================================================================
-- 0007 · Inventario y materiales
-- =====================================================================
-- Valorización por COSTO MÁS ALTO DE COMPRA: el costo unitario de cada
-- artículo es el mayor precio unitario registrado en sus compras. Una
-- compra más barata no lo baja. Cada movimiento guarda el costo vigente
-- para que los reportes históricos no cambien.
-- Los movimientos son inmutables: una corrección se hace con otro movimiento.

create type public.tipo_bodega as enum ('central', 'tecnico');
create type public.unidad_medida as enum ('unidad', 'metro');
create type public.tipo_movimiento as enum (
  'entrada_compra',   -- compra a proveedor → bodega destino
  'salida',           -- baja (pérdida, venta, préstamo) desde bodega origen
  'traspaso',         -- bodega origen → bodega destino
  'ajuste_positivo',  -- corrección de inventario hacia arriba
  'ajuste_negativo',  -- corrección de inventario hacia abajo
  'consumo_ot',       -- material usado en una orden de trabajo
  'devolucion'        -- material o equipo que vuelve a una bodega (ej.: retiro)
);
create type public.estado_equipo as enum (
  'en_bodega', 'asignado_tecnico', 'instalado', 'retirado', 'danado'
);

create table public.bodegas (
  id serial primary key,
  nombre text not null unique,
  tipo public.tipo_bodega not null,
  tecnico_id uuid unique references public.perfiles (id) on delete restrict,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint bodegas_tecnico_requerido check ((tipo = 'tecnico') = (tecnico_id is not null))
);

insert into public.bodegas (nombre, tipo) values ('Bodega central', 'central');

-- Cada técnico tiene su bodega (stock del vehículo). Se crea sola al
-- asignarle el rol de técnico; si ya existía, se reactiva.
create or replace function public.tg_crear_bodega_tecnico()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text;
begin
  if new.rol <> 'tecnico' then
    return new;
  end if;
  if exists (select 1 from public.bodegas where tecnico_id = new.usuario_id) then
    update public.bodegas set activo = true where tecnico_id = new.usuario_id;
    return new;
  end if;
  select 'Bodega ' || coalesce(nullif(btrim(nombre_completo), ''), email) into v_nombre
  from public.perfiles where id = new.usuario_id;
  if exists (select 1 from public.bodegas where nombre = v_nombre) then
    v_nombre := v_nombre || ' (' || left(new.usuario_id::text, 8) || ')';
  end if;
  insert into public.bodegas (nombre, tipo, tecnico_id) values (v_nombre, 'tecnico', new.usuario_id);
  return new;
end;
$$;

create trigger crear_bodega_tecnico
  after insert on public.usuario_roles
  for each row execute function public.tg_crear_bodega_tecnico();

create table public.proveedores (
  id serial primary key,
  nombre text not null,
  rut text check (rut is null or public.rut_es_valido(rut)),
  contacto text,
  telefono text check (telefono is null or public.telefono_es_valido(telefono)),
  whatsapp text check (whatsapp is null or public.telefono_es_valido(whatsapp)),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  observaciones text,
  activo boolean not null default true,
  es_demo boolean not null default false,
  creado_en timestamptz not null default now()
);
create unique index proveedores_rut_key on public.proveedores (rut) where rut is not null;
create trigger proveedores_normalizar_rut
  before insert or update of rut on public.proveedores
  for each row execute function public.tg_normalizar_rut();
create trigger proveedores_normalizar_contacto
  before insert or update on public.proveedores
  for each row execute function public.tg_normalizar_contacto();

create table public.articulos (
  id serial primary key,
  codigo text not null unique check (codigo ~ '^[A-Za-z0-9._-]{2,40}$'),
  nombre text not null,
  categoria text not null check (categoria in (
    'fibra', 'acometida', 'conector', 'pigtail_patchcord', 'splitter', 'nap',
    'ont', 'router', 'herraje', 'herramienta', 'otro'
  )),
  unidad public.unidad_medida not null default 'unidad',
  es_serializado boolean not null default false,
  stock_minimo numeric(12,2) not null default 0 check (stock_minimo >= 0),
  costo_unitario_clp int not null default 0 check (costo_unitario_clp >= 0),
  proveedor_id int references public.proveedores (id),
  activo boolean not null default true,
  es_demo boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint articulos_serializado_por_unidad check (not es_serializado or unidad = 'unidad')
);
create trigger articulos_actualizado_en
  before update on public.articulos
  for each row execute function public.tg_actualizado_en();

-- El costo solo cambia por una compra (movimiento) o por un ajuste del
-- administrador con motivo (función ajustar_costo_articulo). Ambas rutas
-- corren como dueño de la base; los usuarios de la app no pueden tocarlo.
create or replace function public.tg_articulos_proteger_costo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.costo_unitario_clp := 0;
    elsif new.costo_unitario_clp is distinct from old.costo_unitario_clp then
      raise exception 'El costo se actualiza con las compras o con un ajuste de costo del administrador'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger articulos_proteger_costo
  before insert or update on public.articulos
  for each row execute function public.tg_articulos_proteger_costo();

create table public.articulo_costo_ajustes (
  id uuid primary key default gen_random_uuid(),
  articulo_id int not null references public.articulos (id) on delete cascade,
  costo_anterior_clp int not null,
  costo_nuevo_clp int not null check (costo_nuevo_clp >= 0),
  motivo text not null check (length(btrim(motivo)) >= 3),
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now()
);

create table public.stock (
  articulo_id int not null references public.articulos (id) on delete cascade,
  bodega_id int not null references public.bodegas (id),
  cantidad numeric(12,2) not null default 0 check (cantidad >= 0),
  primary key (articulo_id, bodega_id)
);
create index stock_bodega_idx on public.stock (bodega_id);

create table public.equipos (
  id uuid primary key default gen_random_uuid(),
  articulo_id int not null references public.articulos (id),
  numero_serie text not null,
  mac text,
  estado public.estado_equipo not null default 'en_bodega',
  bodega_id int references public.bodegas (id),
  cliente_id uuid references public.clientes (id),
  observaciones text,
  es_demo boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint equipos_ubicacion_coherente check (
    case estado
      when 'en_bodega'        then bodega_id is not null and cliente_id is null
      when 'asignado_tecnico' then bodega_id is not null and cliente_id is null
      when 'instalado'        then cliente_id is not null and bodega_id is null
      else true
    end
  )
);
create unique index equipos_serie_key on public.equipos (articulo_id, upper(numero_serie));
create index equipos_bodega_idx on public.equipos (bodega_id);
create index equipos_cliente_idx on public.equipos (cliente_id);
create trigger equipos_actualizado_en
  before update on public.equipos
  for each row execute function public.tg_actualizado_en();

create table public.movimientos_inventario (
  id uuid primary key default gen_random_uuid(),
  tipo public.tipo_movimiento not null,
  articulo_id int not null references public.articulos (id),
  cantidad numeric(12,2) not null check (cantidad > 0),
  bodega_origen_id int references public.bodegas (id),
  bodega_destino_id int references public.bodegas (id),
  precio_compra_clp int check (precio_compra_clp >= 0),   -- precio unitario pagado (solo compras)
  costo_unitario_clp int not null default 0,              -- costo vigente aplicado (lo fija el sistema)
  proveedor_id int references public.proveedores (id),
  orden_id uuid references public.ordenes_trabajo (id),
  equipo_id uuid references public.equipos (id),
  documento text,                                          -- factura, guía de despacho, etc.
  motivo text,
  es_demo boolean not null default false,
  creado_por uuid references public.perfiles (id) on delete set null default auth.uid(),
  creado_en timestamptz not null default now(),
  constraint movimientos_campos_por_tipo check (
    case tipo
      when 'entrada_compra'  then bodega_destino_id is not null and bodega_origen_id is null
                                  and precio_compra_clp is not null
      when 'salida'          then bodega_origen_id is not null and bodega_destino_id is null
                                  and nullif(btrim(motivo), '') is not null
      when 'traspaso'        then bodega_origen_id is not null and bodega_destino_id is not null
                                  and bodega_origen_id <> bodega_destino_id
      when 'ajuste_positivo' then bodega_destino_id is not null and bodega_origen_id is null
                                  and nullif(btrim(motivo), '') is not null
      when 'ajuste_negativo' then bodega_origen_id is not null and bodega_destino_id is null
                                  and nullif(btrim(motivo), '') is not null
      when 'consumo_ot'      then bodega_origen_id is not null and bodega_destino_id is null
                                  and orden_id is not null
      when 'devolucion'      then bodega_destino_id is not null and bodega_origen_id is null
    end
  )
);
create index movimientos_articulo_idx on public.movimientos_inventario (articulo_id, creado_en desc);
create index movimientos_orden_idx on public.movimientos_inventario (orden_id);
create index movimientos_origen_idx on public.movimientos_inventario (bodega_origen_id);
create index movimientos_destino_idx on public.movimientos_inventario (bodega_destino_id);

-- Aplica el movimiento: costo vigente, stock por bodega y estado del equipo.
create or replace function public.tg_movimiento_aplicar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_art public.articulos%rowtype;
  v_disponible numeric(12,2);
  v_equipo public.equipos%rowtype;
  v_tipo_destino public.tipo_bodega;
  v_cliente uuid;
begin
  select * into v_art from public.articulos where id = new.articulo_id for update;

  -- Costo: una compra más cara sube el costo; nunca lo baja.
  if new.tipo = 'entrada_compra' and new.precio_compra_clp > v_art.costo_unitario_clp then
    update public.articulos set costo_unitario_clp = new.precio_compra_clp where id = v_art.id;
    v_art.costo_unitario_clp := new.precio_compra_clp;
  end if;
  new.costo_unitario_clp := v_art.costo_unitario_clp;

  -- Artículos serializados: un equipo por movimiento.
  if v_art.es_serializado then
    if new.equipo_id is null or new.cantidad <> 1 then
      raise exception 'Los artículos con número de serie se mueven de a uno e indicando el equipo'
        using errcode = '23514';
    end if;
    select * into v_equipo from public.equipos where id = new.equipo_id for update;
    if v_equipo.articulo_id <> new.articulo_id then
      raise exception 'El equipo no corresponde al artículo indicado' using errcode = '23514';
    end if;
    if new.bodega_origen_id is not null and v_equipo.bodega_id is distinct from new.bodega_origen_id then
      raise exception 'El equipo % no está en la bodega de origen', v_equipo.numero_serie
        using errcode = '23514';
    end if;
  elsif new.equipo_id is not null then
    raise exception 'Solo los artículos serializados llevan equipo asociado' using errcode = '23514';
  end if;

  -- Descuento en bodega de origen.
  if new.bodega_origen_id is not null then
    select cantidad into v_disponible
    from public.stock
    where articulo_id = new.articulo_id and bodega_id = new.bodega_origen_id
    for update;
    if coalesce(v_disponible, 0) < new.cantidad then
      raise exception 'Stock insuficiente de "%": disponible %, solicitado %',
        v_art.nombre, coalesce(v_disponible, 0), new.cantidad using errcode = '23514';
    end if;
    update public.stock set cantidad = cantidad - new.cantidad
    where articulo_id = new.articulo_id and bodega_id = new.bodega_origen_id;
  end if;

  -- Ingreso en bodega de destino.
  if new.bodega_destino_id is not null then
    insert into public.stock as s (articulo_id, bodega_id, cantidad)
    values (new.articulo_id, new.bodega_destino_id, new.cantidad)
    on conflict (articulo_id, bodega_id) do update set cantidad = s.cantidad + excluded.cantidad;
  end if;

  -- Estado del equipo según el movimiento.
  if v_art.es_serializado then
    if new.bodega_destino_id is not null then
      select tipo into v_tipo_destino from public.bodegas where id = new.bodega_destino_id;
      update public.equipos
      set bodega_id = new.bodega_destino_id,
          cliente_id = null,
          estado = case when v_tipo_destino = 'tecnico' then 'asignado_tecnico'::public.estado_equipo
                        when new.tipo = 'devolucion' and v_equipo.estado = 'danado' then 'danado'::public.estado_equipo
                        else 'en_bodega'::public.estado_equipo end
      where id = new.equipo_id;
    elsif new.tipo = 'consumo_ot' then
      select cliente_id into v_cliente from public.ordenes_trabajo where id = new.orden_id;
      if v_cliente is null then
        raise exception 'La orden no tiene cliente asociado para instalar el equipo' using errcode = '23514';
      end if;
      update public.equipos
      set bodega_id = null, cliente_id = v_cliente, estado = 'instalado'
      where id = new.equipo_id;
    else
      update public.equipos
      set bodega_id = null, cliente_id = null,
          estado = case when new.tipo = 'salida' then 'retirado'::public.estado_equipo
                        else 'danado'::public.estado_equipo end
      where id = new.equipo_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger movimientos_aplicar
  before insert on public.movimientos_inventario
  for each row execute function public.tg_movimiento_aplicar();

-- Inmutabilidad (salvo la limpieza de datos de demostración).
create or replace function public.tg_movimiento_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.eliminando_demo', true) = 'on' and old.es_demo then
    return old;
  end if;
  raise exception 'Los movimientos de inventario no se modifican ni eliminan; registre un movimiento de corrección'
    using errcode = '42501';
end;
$$;

create trigger movimientos_inmutables
  before update or delete on public.movimientos_inventario
  for each row execute function public.tg_movimiento_inmutable();

-- Ajuste manual del costo, solo administrador y con motivo.
create or replace function public.ajustar_costo_articulo(p_articulo_id int, p_costo_clp int, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anterior int;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ajustar costos' using errcode = '42501';
  end if;
  if p_costo_clp is null or p_costo_clp < 0 then
    raise exception 'El costo debe ser un entero mayor o igual a cero' using errcode = '22023';
  end if;
  if nullif(btrim(p_motivo), '') is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Debe indicar el motivo del ajuste' using errcode = '22023';
  end if;
  select costo_unitario_clp into v_anterior from public.articulos where id = p_articulo_id for update;
  if not found then
    raise exception 'Artículo no encontrado' using errcode = 'P0002';
  end if;
  update public.articulos set costo_unitario_clp = p_costo_clp where id = p_articulo_id;
  insert into public.articulo_costo_ajustes (articulo_id, costo_anterior_clp, costo_nuevo_clp, motivo)
  values (p_articulo_id, v_anterior, p_costo_clp, btrim(p_motivo));
end;
$$;
revoke all on function public.ajustar_costo_articulo(int, int, text) from public, anon;
grant execute on function public.ajustar_costo_articulo(int, int, text) to authenticated;
