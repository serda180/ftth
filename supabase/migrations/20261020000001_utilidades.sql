-- =====================================================================
-- 0001 · Extensiones y funciones utilitarias
-- =====================================================================
-- PostGIS para geometrías y distancias; pg_trgm para búsquedas por texto.
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- RUT chileno
-- Formato almacenado: cuerpo sin puntos + guion + DV en mayúscula
-- (ej.: 12345678-5). Se muestra con puntos solo en la interfaz.
-- ---------------------------------------------------------------------

-- Calcula el dígito verificador (módulo 11) de un cuerpo de RUT.
create or replace function public.rut_calcular_dv(cuerpo bigint)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  suma int := 0;
  multiplicador int := 2;
  resto bigint := cuerpo;
  dv int;
begin
  if cuerpo <= 0 then
    return null;
  end if;
  while resto > 0 loop
    suma := suma + (resto % 10)::int * multiplicador;
    resto := resto / 10;
    multiplicador := case when multiplicador = 7 then 2 else multiplicador + 1 end;
  end loop;
  dv := 11 - (suma % 11);
  return case dv when 11 then '0' when 10 then 'K' else dv::text end;
end;
$$;

-- Normaliza cualquier escritura de RUT ("12.345.678-5", "123456785",
-- " 12345678-k ") al formato almacenado. Devuelve null si no tiene forma de RUT.
create or replace function public.rut_normalizar(entrada text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  limpio text;
  cuerpo text;
begin
  if entrada is null then
    return null;
  end if;
  limpio := upper(regexp_replace(entrada, '[\s.\-]', '', 'g'));
  if limpio !~ '^[0-9]{1,9}[0-9K]$' then
    return null;
  end if;
  cuerpo := ltrim(left(limpio, length(limpio) - 1), '0');
  if cuerpo = '' then
    return null;
  end if;
  return cuerpo || '-' || right(limpio, 1);
end;
$$;

-- Verdadero si el RUT (en cualquier escritura) tiene un DV correcto.
create or replace function public.rut_es_valido(entrada text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  normal text := public.rut_normalizar(entrada);
begin
  if normal is null then
    return false;
  end if;
  return public.rut_calcular_dv(split_part(normal, '-', 1)::bigint) = split_part(normal, '-', 2);
end;
$$;

-- Disparador genérico: normaliza la columna "rut" antes de guardar.
create or replace function public.tg_normalizar_rut()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rut is not null and btrim(new.rut) = '' then
    new.rut := null;
  elsif new.rut is not null then
    new.rut := coalesce(public.rut_normalizar(new.rut), new.rut);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Teléfono chileno: se almacena como +569XXXXXXXX o +56XXXXXXXXX (fijo).
-- ---------------------------------------------------------------------
create or replace function public.telefono_normalizar(entrada text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text;
begin
  if entrada is null or btrim(entrada) = '' then
    return null;
  end if;
  d := regexp_replace(entrada, '[^0-9]', '', 'g');
  if length(d) = 11 and left(d, 2) = '56' then
    return '+' || d;
  elsif length(d) = 9 then
    return '+56' || d;
  end if;
  return entrada; -- no se reconoce: lo rechazará el CHECK
end;
$$;

create or replace function public.telefono_es_valido(entrada text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select entrada ~ '^\+56[2-9][0-9]{8}$';
$$;

-- ---------------------------------------------------------------------
-- Marca de tiempo de actualización
-- ---------------------------------------------------------------------
create or replace function public.tg_actualizado_en()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Correlativos por prefijo y año (OT-2026-00001, SOL-2026-00001).
-- La fila se bloquea durante el UPDATE, así que dos transacciones
-- simultáneas nunca obtienen el mismo número.
-- ---------------------------------------------------------------------
create table public.correlativos (
  prefijo text not null,
  anio int not null,
  ultimo int not null default 0,
  primary key (prefijo, anio)
);
alter table public.correlativos enable row level security;
-- Sin políticas: solo se usa a través de la función siguiente.

create or replace function public.siguiente_correlativo(p_prefijo text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anio int := extract(year from now() at time zone 'America/Santiago')::int;
  v_num int;
begin
  insert into public.correlativos as c (prefijo, anio, ultimo)
  values (p_prefijo, v_anio, 1)
  on conflict (prefijo, anio) do update set ultimo = c.ultimo + 1
  returning c.ultimo into v_num;
  return p_prefijo || '-' || v_anio || '-' || lpad(v_num::text, 5, '0');
end;
$$;
revoke all on function public.siguiente_correlativo(text) from public, anon, authenticated;
