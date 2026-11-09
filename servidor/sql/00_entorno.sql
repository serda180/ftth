-- =====================================================================
-- Entorno base de la Plataforma FTTH en Windows (sin Docker).
--
-- Reemplaza lo que la imagen de Supabase traía hecho: roles de la API,
-- esquemas auth, storage y extensions, y las funciones auth.uid()/jwt().
-- Las migraciones de supabase/migrations se aplican después, sin cambios.
--
-- Es idempotente: el instalador lo ejecuta en cada instalación o
-- actualización, como superusuario, antes de las migraciones.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Roles que usa PostgREST (mismos nombres que en Supabase)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- La contraseña la fija el instalador (alter role ... password).
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;

-- ---------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to public;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Esquema auth: usuarios, sesiones y enlaces de un solo uso
-- (subconjunto compatible con Supabase Auth: mismas columnas que leen
-- las migraciones y las funciones auth.uid / auth.jwt).
-- ---------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text not null default 'authenticated',
  role text not null default 'authenticated',
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb not null default '{"provider": "email", "providers": ["email"]}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists users_email_unico on auth.users (lower(email));

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  refreshed_at timestamptz,
  user_agent text,
  ip text
);
create index if not exists sessions_usuario_idx on auth.sessions (user_id);

create table if not exists auth.refresh_tokens (
  id bigserial primary key,
  token text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references auth.sessions (id) on delete cascade,
  parent text,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refresh_tokens_padre_idx on auth.refresh_tokens (parent);

-- Enlaces de invitación y de recuperación: solo se guarda el hash del token.
create table if not exists auth.enlaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('invite', 'recovery')),
  token_hash text not null unique,
  creado_en timestamptz not null default now(),
  vence_en timestamptz not null,
  usado_en timestamptz
);

-- Nadie fuera del superusuario y de las funciones del servidor toca auth.
revoke all on all tables in schema auth from anon, authenticated, service_role;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  ), '')::text
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.email', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  ), '')::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Esquema storage: metadatos de archivos (los archivos van en disco).
-- Las políticas de acceso las crean las migraciones, como en Supabase.
-- ---------------------------------------------------------------------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid,
  owner_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

grant select, insert, delete on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

create or replace function storage.filename(name text) returns text
language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;

grant execute on function storage.foldername(text), storage.filename(text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Permisos por defecto en public, como en Supabase: RLS decide el acceso.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Registro de migraciones aplicadas (mismo formato que Supabase CLI)
-- ---------------------------------------------------------------------
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
