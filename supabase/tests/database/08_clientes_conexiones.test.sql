-- Pruebas de la Etapa 3: puertos de clientes, conexiones, rutas, impacto y topología.
begin;
select plan(32);

create temp table ids (nombre text primary key, id uuid not null);
grant all on ids to authenticated;
insert into auth.users (id, email) values
  (gen_random_uuid(), 'atencion@test.cl'), (gen_random_uuid(), 'supervisor@test.cl'), (gen_random_uuid(), 'tecnico@test.cl');
insert into ids select split_part(email, '@', 1), id from auth.users where email like '%@test.cl';
insert into public.usuario_roles (usuario_id, rol) values
  ((select id from ids where nombre = 'atencion'), 'atencion_cliente'),
  ((select id from ids where nombre = 'supervisor'), 'supervisor_red'),
  ((select id from ids where nombre = 'tecnico'), 'tecnico');

-- Red mínima creada como dueño de la base: OLT con PON, troncal, NAP
insert into public.elementos_red (codigo, clase, tipo_codigo, ubicacion) values
  ('T3-OLT', 'olt', 'olt', 'SRID=4326;POINT(-72.0000 -37.0000)'),
  ('T3-NAP', 'nap', 'nap', 'SRID=4326;POINT(-72.0050 -37.0000)');
insert into public.olts (elemento_id) select id from public.elementos_red where codigo = 'T3-OLT';
insert into public.olt_puertos_pon (olt_id, slot, puerto, etiqueta)
  select id, 0, 1, 'PON 0/1' from public.elementos_red where codigo = 'T3-OLT';
insert into public.nap (elemento_id, ratio_splitter_id, capacidad_puertos)
  select id, (select id from public.ratios_splitter where ratio = '1:8'), 8 from public.elementos_red where codigo = 'T3-NAP';
insert into public.cables (codigo, tipo, cantidad_fibras, trazado, origen_id, destino_id)
  values ('T3-TR', 'troncal', 12, 'SRID=4326;LINESTRING(-72.0000 -37.0000, -72.0050 -37.0000)',
          (select id from public.elementos_red where codigo = 'T3-OLT'),
          (select id from public.elementos_red where codigo = 'T3-NAP')),
         ('T3-OTRO', 'troncal', 12, 'SRID=4326;LINESTRING(-71.0000 -37.0000, -71.0050 -37.0000)', null, null);
insert into public.planes (nombre, bajada_mbps, subida_mbps, precio_clp) values ('T3 Plan', 300, 150, 15000);
insert into public.clientes (nombre, rut, direccion_calle, direccion_numero, comuna_id, plan_id, estado, ubicacion) values
  ('T3 Uno', '12.345.678-5', 'Calle Prueba', '10', (select min(id) from public.comunas), (select id from public.planes where nombre = 'T3 Plan'), 'activo', 'SRID=4326;POINT(-72.0052 -37.0001)'),
  ('T3 Dos', '11.111.111-1', 'Calle Prueba', '20', (select min(id) from public.comunas), (select id from public.planes where nombre = 'T3 Plan'), 'activo', null);
insert into ids
  select 'p' || p.numero, p.id from public.nap_puertos p join public.elementos_red e on e.id = p.nap_id where e.codigo = 'T3-NAP';
insert into ids select 'uno', id from public.clientes where nombre = 'T3 Uno';
insert into ids select 'dos', id from public.clientes where nombre = 'T3 Dos';
insert into ids select 'hilo1', h.id from public.cable_hilos h join public.cables c on c.id = h.cable_id where c.codigo = 'T3-TR' and h.numero = 1;

set local role authenticated;

-- ---------------- Puertos de clientes (atención al cliente) ----------------
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);

select throws_ok(
  $$ update public.clientes set nap_puerto_id = (select id from ids where nombre = 'p1') where id = (select id from ids where nombre = 'uno') $$,
  '42501', null, 'El puerto no se asigna con un UPDATE directo');
select throws_ok(
  $$ insert into public.clientes (nombre, rut, direccion_calle, comuna_id, nap_puerto_id)
     values ('X', '7.654.321-6', 'C', (select min(id) from public.comunas), (select id from ids where nombre = 'p2')) $$,
  '42501', null, 'Un cliente nuevo no trae puerto: se asigna después');
select lives_ok(
  $$ select public.asignar_puerto_cliente((select id from ids where nombre = 'uno'), (select id from ids where nombre = 'p1')) $$,
  'Atención asigna un puerto libre a un cliente');
select is((select estado::text from public.nap_puertos where id = (select id from ids where nombre = 'p1')), 'ocupado',
          'El puerto queda ocupado');
select is((select nap_puerto_id from public.clientes where id = (select id from ids where nombre = 'uno')),
          (select id from ids where nombre = 'p1'), 'El cliente queda con ese puerto');
select throws_ok(
  $$ select public.asignar_puerto_cliente((select id from ids where nombre = 'dos'), (select id from ids where nombre = 'p1')) $$,
  'P0001', null, 'No se asigna un puerto ocupado a otro cliente');
select lives_ok(
  $$ select public.asignar_puerto_cliente((select id from ids where nombre = 'uno'), (select id from ids where nombre = 'p2')) $$,
  'Se puede cambiar al cliente de puerto');
select is((select string_agg(numero || ':' || estado, ',' order by numero) from public.nap_puertos
           where id in ((select id from ids where nombre = 'p1'), (select id from ids where nombre = 'p2'))),
          '1:libre,2:ocupado', 'Al cambiar de puerto, el anterior queda libre');
select is((select nap_codigo || ' #' || puerto from public.clientes_vista where nombre = 'T3 Uno'), 'T3-NAP #2',
          'La vista de clientes muestra la NAP y el puerto');
select is((select count(*)::int from public.cliente_historial
           where cliente_id = (select id from ids where nombre = 'uno') and tipo = 'cambio_puerto'), 2,
          'Los cambios de puerto quedan en el historial del cliente');

-- ---------------- Técnico ----------------
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico'))::text, true);
select throws_ok(
  $$ select public.asignar_puerto_cliente((select id from ids where nombre = 'dos'), (select id from ids where nombre = 'p3')) $$,
  '42501', null, 'Un técnico no asigna puertos');
select is((select count(*)::int from public.clientes_vista), 0, 'La vista de clientes respeta los permisos del técnico');
select is(public.ruta_cliente((select id from ids where nombre = 'uno')), null::jsonb,
          'Un técnico sin orden asignada no ve la ruta del cliente');

-- ---------------- Conexiones (supervisor) ----------------
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
select throws_ok(
  $$ select public.conectar_nap((select id from public.elementos_red where codigo = 'T3-NAP'), (select id from ids where nombre = 'hilo1')) $$,
  '42501', null, 'Atención no registra conexiones de red');

select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'supervisor'))::text, true);
select lives_ok(
  $$ select public.conectar_nap((select id from public.elementos_red where codigo = 'T3-NAP'), (select id from ids where nombre = 'hilo1'), true) $$,
  'El supervisor registra que el hilo 1 alimenta la NAP');
select is((select estado::text from public.cable_hilos where id = (select id from ids where nombre = 'hilo1')), 'en_uso',
          'El hilo pasa a estar en uso');
select throws_ok(
  $$ select public.conectar_nap((select id from public.elementos_red where codigo = 'T3-NAP'),
       (select h.id from public.cable_hilos h join public.cables c on c.id = h.cable_id where c.codigo = 'T3-TR' and h.numero = 2)) $$,
  'P0001', null, 'Una NAP no recibe una segunda alimentación');
select is((public.camino_nap((select id from public.elementos_red where codigo = 'T3-NAP')) ->> 'completo')::boolean, false,
          'Sin inyección en la OLT, la ruta queda incompleta');
select ok((public.camino_nap((select id from public.elementos_red where codigo = 'T3-NAP')) ->> 'faltante') like 'Sin conexión registrada hacia la OLT%',
          'La ruta incompleta indica qué falta');

select lives_ok(
  $$ select public.inyectar_hilo((select pp.id from public.olt_puertos_pon pp join public.elementos_red e on e.id = pp.olt_id where e.codigo = 'T3-OLT'),
                                 (select id from ids where nombre = 'hilo1')) $$,
  'El supervisor registra que el PON inyecta el hilo 1');

select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
select is((public.ruta_cliente((select id from ids where nombre = 'uno')) ->> 'completo')::boolean, true,
          'La ruta del cliente llega hasta la OLT');
select is((select string_agg(p ->> 'tipo', '>') from jsonb_array_elements(public.ruta_cliente((select id from ids where nombre = 'uno')) -> 'pasos') p),
          'puerto>nap>hilo>pon', 'La ruta pasa por puerto, NAP, hilo y PON');
select is((public.impacto('cable', (select id from public.cables where codigo = 'T3-TR')) #>> '{naps,0,clientes,0,nombre}'), 'T3 Uno',
          'Si falla el troncal, el cliente aparece entre los afectados');
select is((public.impacto('elemento', (select id from public.elementos_red where codigo = 'T3-OLT')) ->> 'total_naps')::int, 1,
          'Si falla la OLT, la NAP aparece afectada');
select is((public.impacto('cable', (select id from public.cables where codigo = 'T3-OTRO')) ->> 'total_naps')::int, 0,
          'Un cable ajeno a la ruta no afecta a la NAP');
select ok((select (public.naps_cercanas(-72.0052, -37.0001, 300) -> 0 ->> 'ruta_completa')::boolean),
          'Las NAP cercanas indican si tienen ruta a la OLT');
select is((select public.naps_cercanas(-72.0052, -37.0001, 300) -> 0 ->> 'libres')::int, 7,
          'Las NAP cercanas informan los puertos libres');
select is((select public.clientes_similares('12345678-5', 'otra', '1', 1) -> 0 ->> 'motivo'), 'rut',
          'Se detecta un posible duplicado por RUT');

-- Retirar libera el puerto
select lives_ok(
  $$ update public.clientes set estado = 'retirado' where id = (select id from ids where nombre = 'uno') $$,
  'Atención retira al cliente');
select is((select estado::text from public.nap_puertos where id = (select id from ids where nombre = 'p2')), 'libre',
          'Al retirar al cliente su puerto queda libre');
select throws_ok(
  $$ select public.asignar_puerto_cliente((select id from ids where nombre = 'uno'), (select id from ids where nombre = 'p3')) $$,
  'P0001', null, 'No se asigna puerto a un cliente retirado');

-- Eliminar la alimentación deja la NAP sin ruta
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'supervisor'))::text, true);
select public.eliminar_conexion((select id from public.conexiones where tipo = 'alimentacion_nap'
  and elemento_id = (select id from public.elementos_red where codigo = 'T3-NAP')));
select ok((select public.topologia() -> 'sin_ruta' @> jsonb_build_array(jsonb_build_object('codigo', 'T3-NAP'))),
          'Sin alimentación, la NAP aparece en la topología como sin ruta');

reset role;
select * from finish();
rollback;
