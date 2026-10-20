-- =====================================================================
-- 0002 · Usuarios, roles y funciones de autorización
-- =====================================================================
-- Los roles viven en una tabla propia. Nunca se leen desde user_metadata,
-- porque ese campo lo puede editar el propio usuario.

create type public.rol_app as enum (
  'administrador',
  'supervisor_red',
  'tecnico',
  'atencion_cliente',
  'inventario'
);

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  nombre_completo text not null default '',
  telefono text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.perfiles is 'Datos de cada usuario de la plataforma (1:1 con auth.users).';

create table public.usuario_roles (
  usuario_id uuid not null references public.perfiles (id) on delete cascade,
  rol public.rol_app not null,
  asignado_por uuid references public.perfiles (id) on delete set null,
  asignado_en timestamptz not null default now(),
  primary key (usuario_id, rol)
);
create index usuario_roles_rol_idx on public.usuario_roles (rol);

create trigger perfiles_actualizado_en
  before update on public.perfiles
  for each row execute function public.tg_actualizado_en();

-- ---------------------------------------------------------------------
-- Alta automática del perfil al crearse un usuario en Supabase Auth
-- (por invitación o por el script de primer administrador).
-- ---------------------------------------------------------------------
create or replace function public.tg_crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, email, nombre_completo)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'nombre_completo', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger crear_perfil_al_registrar
  after insert on auth.users
  for each row execute function public.tg_crear_perfil();

create or replace function public.tg_sincronizar_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.perfiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger sincronizar_email_perfil
  after update of email on auth.users
  for each row execute function public.tg_sincronizar_email();

-- ---------------------------------------------------------------------
-- Funciones de autorización (usadas por RLS y por la interfaz)
-- ---------------------------------------------------------------------

-- Verdadero si el usuario actual está activo y tiene alguno de los roles
-- indicados. El administrador siempre cumple.
create or replace function public.tiene_rol(variadic roles public.rol_app[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuario_roles ur
    join public.perfiles p on p.id = ur.usuario_id
    where ur.usuario_id = (select auth.uid())
      and p.activo
      and (ur.rol = any (roles) or ur.rol = 'administrador')
  );
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.tiene_rol(variadic array[]::public.rol_app[]);
$$;

-- Verdadero si el usuario actual tiene cualquier rol (está habilitado).
create or replace function public.es_usuario_activo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuario_roles ur
    join public.perfiles p on p.id = ur.usuario_id
    where ur.usuario_id = (select auth.uid()) and p.activo
  );
$$;

-- Roles del usuario actual, para que la interfaz arme el menú.
create or replace function public.mis_roles()
returns public.rol_app[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(ur.rol order by ur.rol), array[]::public.rol_app[])
  from public.usuario_roles ur
  join public.perfiles p on p.id = ur.usuario_id
  where ur.usuario_id = (select auth.uid()) and p.activo;
$$;

revoke all on function public.tiene_rol(public.rol_app[]) from public, anon;
revoke all on function public.es_admin() from public, anon;
revoke all on function public.es_usuario_activo() from public, anon;
revoke all on function public.mis_roles() from public, anon;
grant execute on function public.tiene_rol(public.rol_app[]) to authenticated;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.es_usuario_activo() to authenticated;
grant execute on function public.mis_roles() to authenticated;

-- ---------------------------------------------------------------------
-- Protecciones
-- ---------------------------------------------------------------------

-- Siempre debe quedar al menos un administrador activo.
create or replace function public.tg_proteger_ultimo_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  restantes int;
begin
  if tg_table_name = 'usuario_roles' then
    if old.rol <> 'administrador' then
      return old;
    end if;
    select count(*) into restantes
    from public.usuario_roles ur
    join public.perfiles p on p.id = ur.usuario_id
    where ur.rol = 'administrador' and p.activo and ur.usuario_id <> old.usuario_id;
  else -- perfiles: desactivación
    if not (old.activo and not new.activo) then
      return new;
    end if;
    if not exists (select 1 from public.usuario_roles
                   where usuario_id = old.id and rol = 'administrador') then
      return new;
    end if;
    select count(*) into restantes
    from public.usuario_roles ur
    join public.perfiles p on p.id = ur.usuario_id
    where ur.rol = 'administrador' and p.activo and ur.usuario_id <> old.id;
  end if;

  if restantes = 0 then
    raise exception 'Debe quedar al menos un administrador activo'
      using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger proteger_ultimo_admin_rol
  before delete on public.usuario_roles
  for each row execute function public.tg_proteger_ultimo_admin();

create trigger proteger_ultimo_admin_perfil
  before update of activo on public.perfiles
  for each row execute function public.tg_proteger_ultimo_admin();

-- Un usuario puede editar su nombre y teléfono, pero no su email ni su
-- estado. Solo un administrador puede activar o desactivar cuentas.
create or replace function public.tg_proteger_campos_perfil()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.es_admin() then
    return new;  -- procesos internos o administrador
  end if;
  if new.activo is distinct from old.activo or new.email is distinct from old.email then
    raise exception 'No tiene permiso para modificar el estado o el correo del usuario'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger proteger_campos_perfil
  before update on public.perfiles
  for each row execute function public.tg_proteger_campos_perfil();

-- Teléfono del perfil normalizado y validado.
create or replace function public.tg_normalizar_telefono_perfil()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.telefono := public.telefono_normalizar(new.telefono);
  return new;
end;
$$;

create trigger normalizar_telefono_perfil
  before insert or update of telefono on public.perfiles
  for each row execute function public.tg_normalizar_telefono_perfil();

alter table public.perfiles
  add constraint perfiles_telefono_valido
  check (telefono is null or public.telefono_es_valido(telefono));
