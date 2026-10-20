-- Pruebas de permisos por rol (RLS) y de la guardia de órdenes del técnico.
begin;
select plan(17);

create temp table ids (nombre text primary key, id uuid not null);
grant select on ids to authenticated;
insert into auth.users (id, email) values
  (gen_random_uuid(), 'atencion@test.cl'), (gen_random_uuid(), 'tecnico@test.cl'),
  (gen_random_uuid(), 'otrotec@test.cl'), (gen_random_uuid(), 'bodega@test.cl'),
  (gen_random_uuid(), 'admin@test.cl');
insert into ids select split_part(email, '@', 1), id from auth.users where email like '%@test.cl';
insert into public.usuario_roles (usuario_id, rol)
select id, case nombre when 'atencion' then 'atencion_cliente'
                       when 'tecnico'  then 'tecnico'
                       when 'otrotec'  then 'tecnico'
                       when 'bodega'   then 'inventario'
                       when 'admin'    then 'administrador' end::public.rol_app
from ids;

-- Datos base creados como dueño de la base
insert into public.planes (nombre, bajada_mbps, subida_mbps, precio_clp) values ('T Plan', 100, 50, 10000);
insert into public.clientes (nombre, rut, direccion_calle, comuna_id, plan_id, estado)
values ('T Cliente Asignado', '12.345.678-5', 'Calle 1', (select min(id) from public.comunas),
        (select id from public.planes where nombre = 'T Plan'), 'activo'),
       ('T Cliente Ajeno', '11.111.111-1', 'Calle 2', (select min(id) from public.comunas),
        (select id from public.planes where nombre = 'T Plan'), 'activo');
insert into public.ordenes_trabajo (tipo, estado, cliente_id, tecnico_id, descripcion)
values ('reparacion', 'asignada', (select id from public.clientes where nombre = 'T Cliente Asignado'),
        (select id from ids where nombre = 'tecnico'), 'Sin señal'),
       ('reparacion', 'asignada', (select id from public.clientes where nombre = 'T Cliente Ajeno'),
        (select id from ids where nombre = 'otrotec'), 'Lento');

-- ---- anónimo ----
set local role anon;
select throws_ok($$ select count(*) from public.clientes $$, '42501', null,
                 'Un visitante sin sesión no puede leer clientes');
reset role;

set local role authenticated;

-- ---- técnico ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico'))::text, true);
select is((select count(*)::int from public.ordenes_trabajo), 1,
          'El técnico solo ve sus órdenes');
select is((select string_agg(nombre, ',') from public.clientes), 'T Cliente Asignado',
          'El técnico solo ve a los clientes de sus órdenes');
select is((select count(*)::int from public.solicitudes), 0, 'El técnico no ve solicitudes');
select is((select count(*)::int from public.auditoria), 0, 'El técnico no ve la auditoría');
select throws_ok(
  $$ update public.ordenes_trabajo set tecnico_id = (select id from ids where nombre = 'otrotec') $$,
  '42501', null, 'El técnico no puede reasignar su orden');
select throws_ok(
  $$ update public.ordenes_trabajo set estado = 'cancelada' $$,
  '42501', null, 'El técnico no puede cancelar su orden');
select lives_ok(
  $$ update public.ordenes_trabajo set estado = 'en_ejecucion' $$,
  'El técnico puede pasar su orden a ejecución');
select lives_ok(
  $$ update public.ordenes_trabajo set estado = 'completada', potencia_ont_dbm = -19.5,
       resultado_pruebas = 'OK', conformidad_cliente = true $$,
  'El técnico puede cerrar su orden con el resultado');
select ok((select iniciada_en is not null and cerrada_en is not null from public.ordenes_trabajo),
          'Se registran las horas de inicio y cierre');
select throws_ok(
  $$ insert into public.clientes (nombre, rut, direccion_calle, comuna_id)
     values ('X', '12.345.678-5', 'Calle', (select min(id) from public.comunas)) $$,
  '42501', null, 'El técnico no puede crear clientes');

-- ---- inventario ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'bodega'))::text, true);
select is((select count(*)::int from public.clientes), 0, 'Inventario no ve clientes');
select is((select count(*)::int from public.ordenes_trabajo), 0, 'Inventario no ve órdenes de trabajo');

-- ---- atención al cliente ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
select ok((select count(*) from public.clientes where nombre like 'T Cliente%') = 2, 'Atención ve todos los clientes');
select lives_ok(
  $$ insert into public.clientes (nombre, rut, telefono, direccion_calle, comuna_id)
     values ('T Nuevo', '7.654.321-6', '9 1111 2222', 'Calle 3', (select min(id) from public.comunas)) $$,
  'Atención puede registrar clientes');
select throws_ok(
  $$ insert into public.clientes (nombre, rut, direccion_calle, comuna_id)
     values ('T Malo', '7.654.321-0', 'Calle 4', (select min(id) from public.comunas)) $$,
  '23514', null, 'Se rechaza un RUT con dígito verificador incorrecto');
select is((select count(*)::int from public.auditoria), 0, 'Atención no ve la auditoría');

reset role;
select * from finish();
rollback;
