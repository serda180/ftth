-- Pruebas de las funciones del mapa (Etapa 2).
begin;
select plan(26);

create temp table ids (nombre text primary key, id uuid not null);
grant all on ids to authenticated;
insert into auth.users (id, email) values
  (gen_random_uuid(), 'supervisor@test.cl'), (gen_random_uuid(), 'tecnico@test.cl');
insert into ids select split_part(email, '@', 1), id from auth.users where email like '%@test.cl';
insert into public.usuario_roles (usuario_id, rol) values
  ((select id from ids where nombre = 'supervisor'), 'supervisor_red'),
  ((select id from ids where nombre = 'tecnico'), 'tecnico');

set local role authenticated;

-- ---- técnico: puede ver, no editar ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico'))::text, true);
select throws_ok(
  $$ select public.crear_elemento('{"clase":"poste","tipo_codigo":"poste","codigo":"T-P-0","lng":-73.1,"lat":-36.9}') $$,
  '42501', null, 'Un técnico no puede crear elementos');

-- ---- supervisor ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'supervisor'))::text, true);

insert into ids values ('nap', public.crear_elemento(jsonb_build_object(
  'clase', 'nap', 'tipo_codigo', 'nap', 'codigo', 't-nap-9', 'nombre', 'NAP prueba',
  'lng', -73.1000, 'lat', -36.9000, 'sector', 'Prueba',
  'detalle', jsonb_build_object('ratio_splitter_id', (select id from public.ratios_splitter where ratio = '1:16')))));
select is((select codigo from public.elementos_red where id = (select id from ids where nombre = 'nap')), 'T-NAP-9',
          'El código se guarda en mayúsculas');
select is((select capacidad_puertos from public.nap where elemento_id = (select id from ids where nombre = 'nap')), 16,
          'Sin capacidad indicada, la NAP toma la cantidad de salidas del splitter');
select is((select count(*)::int from public.nap_puertos where nap_id = (select id from ids where nombre = 'nap')), 16,
          'La NAP creada desde el mapa tiene sus 16 puertos');

insert into ids values ('olt', public.crear_elemento(jsonb_build_object(
  'clase', 'olt', 'tipo_codigo', 'olt', 'codigo', 'T-OLT-9', 'lng', -73.1100, 'lat', -36.9000,
  'detalle', jsonb_build_object('marca', 'Prueba', 'puertos_pon', 8))));
select is((select count(*)::int from public.olt_puertos_pon where olt_id = (select id from ids where nombre = 'olt')), 8,
          'La OLT se crea con sus puertos PON');

insert into ids values ('poste', public.crear_elemento(jsonb_build_object(
  'clase', 'poste', 'tipo_codigo', 'poste', 'codigo', 'T-POSTE-9', 'lng', -73.1050, 'lat', -36.9000,
  'detalle', jsonb_build_object('material', 'hormigon', 'altura_m', 9))));
select is((select material from public.postes where elemento_id = (select id from ids where nombre = 'poste')), 'hormigon',
          'El poste guarda sus datos propios');

select throws_ok(
  $$ select public.crear_elemento('{"clase":"nap","tipo_codigo":"nap","codigo":"T-NAP-X","lng":-73.1,"lat":-36.9}') $$,
  '23502', null, 'Una NAP exige el ratio del splitter');
select throws_ok(
  $$ select public.crear_elemento('{"clase":"poste","tipo_codigo":"poste","codigo":"T-P-X","lng":-273.1,"lat":-36.9}') $$,
  '22023', null, 'Se rechazan coordenadas fuera de rango');

-- Cable de la OLT a la NAP: el trazado dibujado termina cerca, el sistema lo ajusta
insert into ids values ('cable', public.crear_cable(jsonb_build_object(
  'codigo', 'T-TR-9', 'tipo', 'troncal', 'modelo_cable_id', (select id from public.modelos_cable where nombre = 'ADSS 12F'),
  'origen_id', (select id from ids where nombre = 'olt'), 'destino_id', (select id from ids where nombre = 'nap'),
  'coordenadas', '[[-73.11001, -36.90002], [-73.1050, -36.9000], [-73.10003, -36.90001]]'::jsonb)));
select is((select cantidad_fibras from public.cables where id = (select id from ids where nombre = 'cable')), 12,
          'Sin cantidad de fibras, el cable la toma del modelo');
select is((select count(*)::int from public.cable_hilos where cable_id = (select id from ids where nombre = 'cable')), 12,
          'El cable creado desde el mapa tiene sus 12 hilos');
select is((select public.coordenadas_de(trazado) -> 0 from public.cables where id = (select id from ids where nombre = 'cable')),
          '[-73.11, -36.9]'::jsonb, 'El inicio del trazado queda exactamente sobre la OLT');
select is((select public.coordenadas_de(trazado) -> -1 from public.cables where id = (select id from ids where nombre = 'cable')),
          '[-73.1, -36.9]'::jsonb, 'El final del trazado queda exactamente sobre la NAP');
select ok((select longitud_mapa_m between 880 and 900 from public.cables where id = (select id from ids where nombre = 'cable')),
          'La longitud se calcula sola en metros (~890 m)');

-- Mover la NAP arrastra el extremo del cable
select lives_ok(
  $$ select public.mover_elemento((select id from ids where nombre = 'nap'), -73.0990, -36.9010) $$,
  'El supervisor puede mover un elemento');
select is((select public.coordenadas_de(trazado) -> -1 from public.cables where id = (select id from ids where nombre = 'cable')),
          '[-73.099, -36.901]'::jsonb, 'Al mover la NAP, el extremo del cable la sigue');

-- Carga por zona
select is((select (public.mapa_elementos(-73.12, -36.91, -73.09, -36.89, 17) -> 'items')::jsonb @>
                  jsonb_build_array(jsonb_build_object('codigo', 'T-NAP-9', 'nap', jsonb_build_object('libres', 16)))),
          true, 'El mapa devuelve la NAP con sus puertos libres');
select is((select jsonb_array_length(public.mapa_elementos(-73.12, -36.91, -73.09, -36.89, 17, array['poste']::public.clase_elemento[]) -> 'items')),
          1, 'El filtro por clase devuelve solo postes');
select is((select jsonb_array_length(public.mapa_elementos(-70.0, -33.5, -69.9, -33.4, 17) -> 'items')),
          0, 'Fuera de la zona visible no se devuelve nada');
select is((select jsonb_array_length(public.mapa_cables(-73.12, -36.91, -73.09, -36.89))), 1,
          'El mapa devuelve el cable de la zona');

-- Ficha, búsqueda y puertos
select is((select jsonb_array_length(public.ficha_elemento((select id from ids where nombre = 'nap')) -> 'puertos')), 16,
          'La ficha de la NAP trae la grilla de puertos');
select is((select (public.buscar_red('t-nap-9') -> 0 ->> 'titulo')), 'T-NAP-9', 'La búsqueda encuentra la NAP por código');
select lives_ok(
  $$ update public.nap_puertos set estado = 'averiado' where nap_id = (select id from ids where nombre = 'nap') and numero = 3 $$,
  'El supervisor puede marcar un puerto como averiado');
select throws_ok(
  $$ update public.nap_puertos set estado = 'ocupado' where nap_id = (select id from ids where nombre = 'nap') and numero = 4 $$,
  '42501', null, 'Un puerto no se marca ocupado a mano');

-- Bajas con dependencias
select throws_ok(
  $$ select public.eliminar_elemento((select id from ids where nombre = 'nap')) $$,
  'P0001', null, 'No se elimina una NAP con cables que llegan a ella');
select lives_ok(
  $$ select public.eliminar_cable((select id from ids where nombre = 'cable')) $$,
  'Un cable sin conexiones se puede eliminar');
select lives_ok(
  $$ select public.eliminar_elemento((select id from ids where nombre = 'nap')) $$,
  'Sin cables, la NAP se puede eliminar (baja lógica)');

reset role;
select * from finish();
rollback;
