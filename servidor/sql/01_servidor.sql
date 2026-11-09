-- =====================================================================
-- Funciones privilegiadas del servidor de la Plataforma FTTH.
--
-- Las llama solo servidor/servidor.mjs a través de PostgREST con el rol
-- service_role (que nunca sale del PC servidor). El navegador no puede:
-- el servidor rechaza los encabezados Accept-Profile/Content-Profile y
-- service_role es el único rol con permiso de ejecución.
--
-- Idempotente: se vuelve a ejecutar en cada instalación o actualización.
-- =====================================================================

create schema if not exists servidor;
revoke all on schema servidor from public;
grant usage on schema servidor to service_role;

-- Usuario con el formato que espera supabase-js.
create or replace function servidor.usuario_json(u auth.users)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id,
    'aud', u.aud,
    'role', u.role,
    'email', u.email,
    'email_confirmed_at', u.email_confirmed_at,
    'confirmed_at', u.email_confirmed_at,
    'invited_at', u.invited_at,
    'phone', '',
    'last_sign_in_at', u.last_sign_in_at,
    'app_metadata', u.raw_app_meta_data,
    'user_metadata', u.raw_user_meta_data,
    'identities', '[]'::jsonb,
    'is_anonymous', false,
    'created_at', u.created_at,
    'updated_at', u.updated_at
  )
$$;

-- Crea sesión y refresh token. Uso interno.
create or replace function servidor._nueva_sesion(p_usuario uuid, p_agente text, p_ip text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sesion uuid;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  u auth.users;
begin
  insert into auth.sessions (user_id, user_agent, ip) values (p_usuario, left(p_agente, 300), left(p_ip, 60))
  returning id into v_sesion;
  insert into auth.refresh_tokens (token, user_id, session_id) values (v_token, p_usuario, v_sesion);
  update auth.users set last_sign_in_at = now() where id = p_usuario returning * into u;
  return jsonb_build_object('usuario', servidor.usuario_json(u), 'sesion', v_sesion, 'refresh_token', v_token);
end;
$$;

-- Ingreso con correo y contraseña.
create or replace function servidor.iniciar_sesion(p_email text, p_clave text, p_agente text default null, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u auth.users;
begin
  select * into u from auth.users where lower(email) = lower(trim(p_email));
  if u.id is null or u.encrypted_password is null
     or extensions.crypt(p_clave, u.encrypted_password) <> u.encrypted_password then
    return jsonb_build_object('error', 'invalid_credentials');
  end if;
  if u.email_confirmed_at is null then
    return jsonb_build_object('error', 'email_not_confirmed');
  end if;
  if u.banned_until is not null and u.banned_until > now() then
    return jsonb_build_object('error', 'user_banned');
  end if;
  return servidor._nueva_sesion(u.id, p_agente, p_ip);
end;
$$;

-- Renueva la sesión con rotación del refresh token. Tolera reusar el
-- token recién rotado durante 10 s (varias pestañas a la vez).
create or replace function servidor.refrescar(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t auth.refresh_tokens;
  hijo text;
  nuevo text := encode(extensions.gen_random_bytes(32), 'hex');
  u auth.users;
begin
  select * into t from auth.refresh_tokens where token = p_token for update;
  if t.id is null then
    return jsonb_build_object('error', 'refresh_token_not_found');
  end if;
  select * into u from auth.users where id = t.user_id;
  if u.banned_until is not null and u.banned_until > now() then
    delete from auth.sessions where user_id = u.id;
    return jsonb_build_object('error', 'user_banned');
  end if;
  if t.revoked then
    select token into hijo from auth.refresh_tokens where parent = t.token and not revoked
      order by id desc limit 1;
    if hijo is not null and t.updated_at > now() - interval '10 seconds' then
      return jsonb_build_object('usuario', servidor.usuario_json(u), 'sesion', t.session_id, 'refresh_token', hijo);
    end if;
    -- Reuso fuera de plazo: posible robo del token; se cierra la sesión.
    delete from auth.sessions where id = t.session_id;
    return jsonb_build_object('error', 'refresh_token_already_used');
  end if;
  update auth.refresh_tokens set revoked = true, updated_at = now() where id = t.id;
  insert into auth.refresh_tokens (token, user_id, session_id, parent) values (nuevo, t.user_id, t.session_id, t.token);
  update auth.sessions set refreshed_at = now() where id = t.session_id;
  return jsonb_build_object('usuario', servidor.usuario_json(u), 'sesion', t.session_id, 'refresh_token', nuevo);
end;
$$;

-- Comprueba que la sesión del token de acceso siga abierta y devuelve el usuario.
create or replace function servidor.usuario(p_id uuid, p_sesion uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select servidor.usuario_json(u)
  from auth.users u
  where u.id = p_id
    and (u.banned_until is null or u.banned_until <= now())
    and exists (select 1 from auth.sessions s where s.id = p_sesion and s.user_id = u.id)
$$;

-- Cambio de contraseña y/o datos del propio usuario.
create or replace function servidor.actualizar_usuario(p_id uuid, p_clave text default null, p_datos jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u auth.users;
begin
  if p_clave is not null and length(p_clave) < 8 then
    return jsonb_build_object('error', 'weak_password');
  end if;
  update auth.users set
    encrypted_password = case when p_clave is null then encrypted_password
                              else extensions.crypt(p_clave, extensions.gen_salt('bf', 10)) end,
    email_confirmed_at = coalesce(email_confirmed_at, case when p_clave is not null then now() end),
    raw_user_meta_data = case when p_datos is null then raw_user_meta_data else raw_user_meta_data || p_datos end,
    updated_at = now()
  where id = p_id
  returning * into u;
  if u.id is null then
    return jsonb_build_object('error', 'user_not_found');
  end if;
  return jsonb_build_object('usuario', servidor.usuario_json(u));
end;
$$;

-- Cierre de sesión: global (todas), local (esta) u others (las demás).
create or replace function servidor.cerrar_sesion(p_usuario uuid, p_sesion uuid, p_alcance text default 'global')
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions
  where user_id = p_usuario
    and case p_alcance
          when 'local' then id = p_sesion
          when 'others' then id <> p_sesion
          else true
        end
$$;

-- Enlace de un solo uso (invitación o recuperación). Devuelve el token
-- en claro una sola vez; en la base queda su hash SHA-256.
create or replace function servidor.crear_enlace(p_usuario uuid, p_tipo text, p_horas int default 72)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if p_tipo not in ('invite', 'recovery') then
    raise exception 'tipo de enlace no válido: %', p_tipo;
  end if;
  update auth.enlaces set usado_en = now()
    where user_id = p_usuario and tipo = p_tipo and usado_en is null;
  insert into auth.enlaces (user_id, tipo, token_hash, vence_en)
    values (p_usuario, p_tipo, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + make_interval(hours => p_horas));
  return v_token;
end;
$$;

-- Canjea un enlace y abre una sesión.
create or replace function servidor.usar_enlace(p_token text, p_tipo text, p_agente text default null, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e auth.enlaces;
  u auth.users;
begin
  select * into e from auth.enlaces
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and tipo = p_tipo
    for update;
  if e.id is null or e.usado_en is not null or e.vence_en < now() then
    return jsonb_build_object('error', 'otp_expired');
  end if;
  select * into u from auth.users where id = e.user_id;
  if u.banned_until is not null and u.banned_until > now() then
    return jsonb_build_object('error', 'user_banned');
  end if;
  update auth.enlaces set usado_en = now() where id = e.id;
  if p_tipo = 'invite' then
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = u.id;
  end if;
  return servidor._nueva_sesion(u.id, p_agente, p_ip);
end;
$$;

create or replace function servidor.buscar_por_email(p_email text)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email))
    and (banned_until is null or banned_until <= now())
$$;

-- Alta de usuario invitado (sin contraseña) con sus roles.
create or replace function servidor.invitar(p_email text, p_nombre text, p_roles public.rol_app[], p_por uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if exists (select 1 from auth.users where lower(email) = lower(trim(p_email))) then
    return jsonb_build_object('error', 'email_exists');
  end if;
  insert into auth.users (email, invited_at, raw_user_meta_data)
    values (lower(trim(p_email)), now(), jsonb_build_object('nombre_completo', trim(p_nombre)))
    returning id into v_id;
  -- El perfil lo crea el disparador public.tg_crear_perfil.
  insert into public.usuario_roles (usuario_id, rol, asignado_por)
    select v_id, r, p_por from unnest(p_roles) r;
  return jsonb_build_object('usuario_id', v_id);
end;
$$;

-- Alta directa con contraseña (instalador y "Crear usuario" del menú Inicio).
create or replace function servidor.crear_usuario(p_email text, p_clave text, p_nombre text, p_rol public.rol_app)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if length(coalesce(p_clave, '')) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres';
  end if;
  if exists (select 1 from auth.users where lower(email) = lower(trim(p_email))) then
    raise exception 'Ya existe un usuario con el correo %', p_email;
  end if;
  insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values (lower(trim(p_email)), extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), now(),
            jsonb_build_object('nombre_completo', trim(p_nombre)))
    returning id into v_id;
  insert into public.usuario_roles (usuario_id, rol) values (v_id, p_rol);
  return v_id;
end;
$$;

-- Activa o desactiva una cuenta. El disparador de perfiles impide dejar
-- la plataforma sin administradores activos.
create or replace function servidor.cambiar_estado(p_usuario uuid, p_activo boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.perfiles set activo = p_activo where id = p_usuario;
  if not found then
    raise exception 'Usuario no encontrado';
  end if;
  update auth.users
    set banned_until = case when p_activo then null else 'infinity'::timestamptz end, updated_at = now()
    where id = p_usuario;
  if not p_activo then
    delete from auth.sessions where user_id = p_usuario;
  end if;
end;
$$;

-- Limpieza periódica: sesiones sin uso hace 60 días y enlaces vencidos.
create or replace function servidor.limpiar()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where coalesce(refreshed_at, created_at) < now() - interval '60 days';
  delete from auth.enlaces where vence_en < now() - interval '30 days';
  delete from auth.refresh_tokens where revoked and updated_at < now() - interval '1 day';
$$;

-- Solo service_role puede ejecutar estas funciones.
revoke all on all functions in schema servidor from public;
grant execute on all functions in schema servidor to service_role;
