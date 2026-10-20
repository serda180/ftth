-- Pruebas de usuarios, roles y protecciones de cuentas.
begin;
select plan(12);

create temp table ids (nombre text primary key, id uuid not null);
grant select on ids to authenticated;

insert into auth.users (id, email, raw_user_meta_data)
values (gen_random_uuid(), 'admin@test.cl', '{"nombre_completo": "Admin Prueba"}'),
       (gen_random_uuid(), 'tecnico@test.cl', '{}');
insert into ids select split_part(email, '@', 1), id from auth.users where email like '%@test.cl';

select is((select nombre_completo from public.perfiles where id = (select id from ids where nombre = 'admin')),
          'Admin Prueba', 'Al crear el usuario en Auth se crea su perfil con el nombre');

-- Solo aplica la regla de "último administrador" sobre administradores reales:
-- se retiran temporalmente los que existan para probar en aislamiento.
delete from public.usuario_roles where rol = 'administrador';
insert into public.usuario_roles (usuario_id, rol)
values ((select id from ids where nombre = 'admin'), 'administrador'),
       ((select id from ids where nombre = 'tecnico'), 'tecnico');

-- ---- como técnico ----
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico'))::text, true);

select is(public.mis_roles(), array['tecnico']::public.rol_app[], 'mis_roles devuelve los roles del usuario');
select ok(public.tiene_rol('tecnico'), 'El técnico tiene el rol técnico');
select ok(not public.tiene_rol('supervisor_red'), 'El técnico no tiene rol de supervisor');
select throws_ok(
  $$ insert into public.usuario_roles (usuario_id, rol) select id, 'administrador' from ids where nombre = 'tecnico' $$,
  '42501', null, 'Un técnico no puede asignarse el rol de administrador');
select throws_ok(
  $$ update public.perfiles set activo = false where id = (select id from ids where nombre = 'tecnico') $$,
  '42501', null, 'Un usuario no puede cambiar su propio estado');
select lives_ok(
  $$ update public.perfiles set nombre_completo = 'Técnico Uno', telefono = '9 8765 4321'
     where id = (select id from ids where nombre = 'tecnico') $$,
  'Un usuario puede editar su nombre y teléfono');
select is((select count(*)::int from public.perfiles), 1, 'Un técnico solo ve su propio perfil');

-- ---- como administrador ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'admin'))::text, true);
select ok(public.tiene_rol('inventario'), 'El administrador cumple cualquier rol');
select throws_ok(
  $$ delete from public.usuario_roles where rol = 'administrador' $$,
  'P0001', null, 'No se puede quitar el último administrador');
select lives_ok(
  $$ update public.perfiles set activo = false where id = (select id from ids where nombre = 'tecnico') $$,
  'El administrador puede desactivar a otro usuario');

-- ---- usuario desactivado pierde acceso ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico'))::text, true);
select ok(not public.es_usuario_activo(), 'Un usuario desactivado deja de estar activo para RLS');

reset role;
select * from finish();
rollback;
