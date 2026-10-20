-- =====================================================================
-- 0008 · Auditoría
-- =====================================================================
-- Registra quién cambió qué y cuándo. En las actualizaciones guarda solo
-- los campos que cambiaron. La tabla no es editable desde la aplicación.

create table public.auditoria (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id text not null,
  accion text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  usuario_id uuid,
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  creado_en timestamptz not null default now()
);
create index auditoria_registro_idx on public.auditoria (tabla, registro_id, creado_en desc);
create index auditoria_fecha_idx on public.auditoria (creado_en desc);
create index auditoria_usuario_idx on public.auditoria (usuario_id, creado_en desc);

create or replace function public.tg_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_fila jsonb := coalesce(v_new, v_old);
  v_id text;
  v_antes jsonb := v_old;
  v_despues jsonb := v_new;
  k text;
begin
  v_id := coalesce(
    v_fila ->> 'id',
    v_fila ->> 'elemento_id',
    v_fila ->> 'clave',
    case when v_fila ? 'usuario_id' and v_fila ? 'rol'
         then (v_fila ->> 'usuario_id') || ':' || (v_fila ->> 'rol') end,
    '?'
  );

  if tg_op = 'UPDATE' then
    v_antes := '{}'::jsonb;
    v_despues := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if k <> 'actualizado_en' and (v_new -> k) is distinct from (v_old -> k) then
        v_antes := v_antes || jsonb_build_object(k, v_old -> k);
        v_despues := v_despues || jsonb_build_object(k, v_new -> k);
      end if;
    end loop;
    if v_despues = '{}'::jsonb then
      return null;  -- nada relevante cambió
    end if;
  end if;

  insert into public.auditoria (tabla, registro_id, accion, usuario_id, datos_anteriores, datos_nuevos)
  values (tg_table_name, v_id, tg_op, (select auth.uid()), v_antes, v_despues);
  return null;
end;
$$;

-- Tablas auditadas en todas sus operaciones.
do $$
declare
  t text;
begin
  foreach t in array array[
    'perfiles', 'usuario_roles', 'planes', 'configuracion', 'comunas', 'tipos_elemento',
    'modelos_cable', 'ratios_splitter',
    'elementos_red', 'olts', 'olt_puertos_pon', 'nap', 'postes', 'camaras', 'cajas_empalme',
    'splitters', 'gabinetes', 'puntos_ingreso', 'cables', 'cable_soportes', 'conexiones',
    'zonas_cobertura',
    'clientes', 'solicitudes', 'ordenes_trabajo',
    'bodegas', 'proveedores', 'articulos', 'equipos'
  ] loop
    execute format(
      'create trigger auditar after insert or update or delete on public.%I
         for each row execute function public.tg_auditar()', t);
  end loop;
end;
$$;

-- Puertos e hilos se generan en bloque al crear una NAP o un cable; solo
-- se auditan sus cambios posteriores (estado, observaciones).
create trigger auditar after update or delete on public.nap_puertos
  for each row execute function public.tg_auditar();
create trigger auditar after update or delete on public.cable_hilos
  for each row execute function public.tg_auditar();
