-- Pruebas de infraestructura: puertos de NAP, hilos de cable y conexiones.
begin;
select plan(14);

create temp table ids (nombre text primary key, id uuid not null);
grant select on ids to authenticated;
insert into auth.users (id, email) values (gen_random_uuid(), 'supervisor@test.cl'), (gen_random_uuid(), 'atencion@test.cl');
insert into ids select split_part(email, '@', 1), id from auth.users where email like '%@test.cl';
insert into public.usuario_roles (usuario_id, rol)
values ((select id from ids where nombre = 'supervisor'), 'supervisor_red'),
       ((select id from ids where nombre = 'atencion'), 'atencion_cliente');

set local role authenticated;

-- ---- atención al cliente no edita infraestructura ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
select throws_ok(
  $$ insert into public.elementos_red (codigo, clase, tipo_codigo, ubicacion)
     values ('T-NAP-X', 'nap', 'nap', 'SRID=4326;POINT(-73.05 -36.82)') $$,
  '42501', null, 'Atención al cliente no puede crear elementos de red');

-- ---- supervisor de red ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'supervisor'))::text, true);

insert into public.elementos_red (codigo, clase, tipo_codigo, nombre, ubicacion)
values ('T-NAP-1', 'nap', 'nap', 'NAP prueba', 'SRID=4326;POINT(-73.05 -36.82)'),
       ('T-POSTE-1', 'poste', 'poste', 'Poste prueba', 'SRID=4326;POINT(-73.051 -36.821)');

select throws_ok(
  $$ insert into public.nap (elemento_id, ratio_splitter_id, capacidad_puertos)
     select id, 1, 8 from public.elementos_red where codigo = 'T-POSTE-1' $$,
  '23503', null, 'Una fila de NAP no puede colgar de un elemento de otra clase');
select throws_ok(
  $$ insert into public.elementos_red (codigo, clase, tipo_codigo, ubicacion)
     values ('T-MAL', 'poste', 'nap', 'SRID=4326;POINT(-73.05 -36.82)') $$,
  '23503', null, 'El tipo debe pertenecer a la clase del elemento');
select throws_ok(
  $$ insert into public.elementos_red (codigo, clase, tipo_codigo, ubicacion)
     values ('t-nap-1', 'nap', 'nap', 'SRID=4326;POINT(-73.05 -36.82)') $$,
  '23505', null, 'El código es único sin distinguir mayúsculas');

insert into public.nap (elemento_id, ratio_splitter_id, capacidad_puertos)
select id, (select id from public.ratios_splitter where ratio = '1:8'), 8
from public.elementos_red where codigo = 'T-NAP-1';

select is((select count(*)::int from public.nap_puertos p join public.elementos_red e on e.id = p.nap_id
           where e.codigo = 'T-NAP-1'), 8, 'Al crear una NAP de 8 puertos se generan 8 puertos libres');

update public.nap set capacidad_puertos = 16
where elemento_id = (select id from public.elementos_red where codigo = 'T-NAP-1');
select is((select max(numero) from public.nap_puertos p join public.elementos_red e on e.id = p.nap_id
           where e.codigo = 'T-NAP-1'), 16, 'Aumentar la capacidad agrega los puertos 9 a 16');

update public.nap_puertos set estado = 'averiado'
where numero = 12 and nap_id = (select id from public.elementos_red where codigo = 'T-NAP-1');
select throws_ok(
  $$ update public.nap set capacidad_puertos = 8
     where elemento_id = (select id from public.elementos_red where codigo = 'T-NAP-1') $$,
  'P0001', null, 'No se reduce la capacidad si se perderían puertos no libres');

update public.nap_puertos set estado = 'libre'
where numero = 12 and nap_id = (select id from public.elementos_red where codigo = 'T-NAP-1');
select lives_ok(
  $$ update public.nap set capacidad_puertos = 8
     where elemento_id = (select id from public.elementos_red where codigo = 'T-NAP-1') $$,
  'Con los puertos libres sí se puede reducir la capacidad');

-- Cable troncal con hilos
insert into public.cables (codigo, tipo, cantidad_fibras, modelo_cable_id, trazado)
values ('T-TR-1', 'troncal', 24, (select id from public.modelos_cable where nombre = 'ADSS 24F'),
        'SRID=4326;LINESTRING(-73.05 -36.82, -73.04 -36.81)');

select is((select count(*)::int from public.cable_hilos h join public.cables c on c.id = h.cable_id
           where c.codigo = 'T-TR-1'), 24, 'Un cable de 24 fibras genera 24 hilos');
select is((select color || ' T' || tubo from public.cable_hilos h join public.cables c on c.id = h.cable_id
           where c.codigo = 'T-TR-1' and h.numero = 14), 'Naranjo T2',
          'El hilo 14 es naranjo del tubo 2 (TIA-598)');

-- Conexiones
insert into public.conexiones (tipo, hilo_origen_id, elemento_id)
select 'alimentacion_nap', h.id, (select id from public.elementos_red where codigo = 'T-NAP-1')
from public.cable_hilos h join public.cables c on c.id = h.cable_id
where c.codigo = 'T-TR-1' and h.numero = 1;

select throws_ok(
  $$ insert into public.conexiones (tipo, hilo_origen_id, elemento_id)
     select 'alimentacion_nap', h.id, (select id from public.elementos_red where codigo = 'T-NAP-1')
     from public.cable_hilos h join public.cables c on c.id = h.cable_id
     where c.codigo = 'T-TR-1' and h.numero = 2 $$,
  '23505', null, 'Una NAP se alimenta de un solo hilo');
select throws_ok(
  $$ insert into public.conexiones (tipo, hilo_origen_id, elemento_id)
     select 'alimentacion_nap', h.id, (select id from public.elementos_red where codigo = 'T-POSTE-1')
     from public.cable_hilos h join public.cables c on c.id = h.cable_id
     where c.codigo = 'T-TR-1' and h.numero = 3 $$,
  '23514', null, 'La alimentación de NAP debe apuntar a una NAP');
select throws_ok(
  $$ insert into public.conexiones (tipo, elemento_id)
     values ('alimentacion_nap', (select id from public.elementos_red where codigo = 'T-NAP-1')) $$,
  '23514', null, 'La conexión exige los campos de su tipo');

reset role;
select is((select count(*)::int from public.auditoria where tabla = 'nap'
           and registro_id = (select id::text from public.elementos_red where codigo = 'T-NAP-1')),
          3, 'Crear y cambiar la capacidad de la NAP queda en la auditoría');

select * from finish();
rollback;
