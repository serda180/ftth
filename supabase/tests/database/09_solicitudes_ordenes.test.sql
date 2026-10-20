-- Pruebas de la Etapa 4: factibilidad, reservas, órdenes, cierre con activación y fotos.
begin;
select plan(35);

create temp table ids (nombre text primary key, id uuid not null);
grant all on ids to authenticated;
insert into auth.users (id, email) values
  (gen_random_uuid(), 'atencion@test.cl'), (gen_random_uuid(), 'supervisor@test.cl'),
  (gen_random_uuid(), 'tecnico@test.cl'), (gen_random_uuid(), 'tecnico2@test.cl');
insert into ids select split_part(email, '@', 1), id from auth.users where email like '%@test.cl';
insert into public.usuario_roles (usuario_id, rol) values
  ((select id from ids where nombre = 'atencion'), 'atencion_cliente'),
  ((select id from ids where nombre = 'supervisor'), 'supervisor_red'),
  ((select id from ids where nombre = 'tecnico'), 'tecnico'),
  ((select id from ids where nombre = 'tecnico2'), 'tecnico');

-- Red con ruta completa: OLT → PON → troncal hilo 1 → NAP
insert into public.elementos_red (codigo, clase, tipo_codigo, ubicacion) values
  ('T4-OLT', 'olt', 'olt', 'SRID=4326;POINT(-72.0000 -38.0000)'),
  ('T4-NAP', 'nap', 'nap', 'SRID=4326;POINT(-72.0050 -38.0000)');
insert into public.olts (elemento_id) select id from public.elementos_red where codigo = 'T4-OLT';
insert into public.olt_puertos_pon (olt_id, slot, puerto, etiqueta) select id, 0, 1, 'PON 0/1' from public.elementos_red where codigo = 'T4-OLT';
insert into public.nap (elemento_id, ratio_splitter_id, capacidad_puertos)
  select id, (select id from public.ratios_splitter where ratio = '1:8'), 8 from public.elementos_red where codigo = 'T4-NAP';
insert into public.cables (codigo, tipo, cantidad_fibras, trazado, origen_id, destino_id)
  values ('T4-TR', 'troncal', 12, 'SRID=4326;LINESTRING(-72.0000 -38.0000, -72.0050 -38.0000)',
          (select id from public.elementos_red where codigo = 'T4-OLT'), (select id from public.elementos_red where codigo = 'T4-NAP'));
insert into ids select 'hilo1', h.id from public.cable_hilos h join public.cables c on c.id = h.cable_id where c.codigo = 'T4-TR' and h.numero = 1;
insert into public.conexiones (tipo, olt_puerto_pon_id, hilo_destino_id, confirmada)
  select 'inyeccion_olt', pp.id, (select id from ids where nombre = 'hilo1'), true
  from public.olt_puertos_pon pp join public.elementos_red e on e.id = pp.olt_id where e.codigo = 'T4-OLT';
insert into public.conexiones (tipo, hilo_origen_id, elemento_id, confirmada)
  select 'alimentacion_nap', (select id from ids where nombre = 'hilo1'), id, true from public.elementos_red where codigo = 'T4-NAP';
insert into ids select 'p' || p.numero, p.id from public.nap_puertos p join public.elementos_red e on e.id = p.nap_id where e.codigo = 'T4-NAP';
insert into public.planes (nombre, bajada_mbps, subida_mbps, precio_clp) values ('T4 Plan', 600, 300, 19990);

set local role authenticated;

-- ---------------- Atención registra la solicitud ----------------
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
insert into public.solicitudes (nombre, rut, telefono, direccion_calle, direccion_numero, comuna_id, ubicacion, plan_id)
values ('T4 Solicitante', '12.345.678-5', '9 8888 7777', 'Pasaje Prueba', '5', (select min(id) from public.comunas),
        'SRID=4326;POINT(-72.0052 -38.0005)', (select id from public.planes where nombre = 'T4 Plan')),
       ('T4 Segundo', '11.111.111-1', null, 'Pasaje Prueba', '9', (select min(id) from public.comunas),
        'SRID=4326;POINT(-72.0053 -38.0006)', (select id from public.planes where nombre = 'T4 Plan'));
insert into ids select 'sol1', id from public.solicitudes where nombre = 'T4 Solicitante';
insert into ids select 'sol2', id from public.solicitudes where nombre = 'T4 Segundo';

select ok((select numero ~ '^SOL-[0-9]{4}-[0-9]{5}$' from public.solicitudes where id = (select id from ids where nombre = 'sol1')),
          'La solicitud recibe un número correlativo');
select is((public.evaluar_factibilidad((select id from ids where nombre = 'sol1')) ->> 'recomendacion'), 'factible',
          'Con NAP cercana, puertos libres y ruta completa, la recomendación es factible');
select ok((public.evaluar_factibilidad((select id from ids where nombre = 'sol1')) #>> '{naps,0,margen_db}')::numeric > 0,
          'Se estima el margen del presupuesto óptico');
select throws_ok(
  $$ select public.decidir_factibilidad((select id from ids where nombre = 'sol1'), 'factible', null,
       (select id from public.elementos_red where codigo = 'T4-NAP')) $$,
  '42501', null, 'Atención no decide la factibilidad');

-- ---------------- Supervisor decide ----------------
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'supervisor'))::text, true);
select throws_ok(
  $$ select public.decidir_factibilidad((select id from ids where nombre = 'sol1'), 'no_factible', '  ') $$,
  '23502', null, 'Rechazar exige un motivo');
select lives_ok(
  $$ select public.decidir_factibilidad((select id from ids where nombre = 'sol1'), 'factible', 'NAP a 50 m',
       (select id from public.elementos_red where codigo = 'T4-NAP')) $$,
  'El supervisor aprueba la factibilidad');
select ok((select estado = 'factible' and factibilidad is not null and evaluado_por is not null
           from public.solicitudes where id = (select id from ids where nombre = 'sol1')),
          'Queda factible, con el análisis guardado y quién lo evaluó');
select public.decidir_factibilidad((select id from ids where nombre = 'sol2'), 'factible', null,
       (select id from public.elementos_red where codigo = 'T4-NAP'));

-- ---------------- Reservas ----------------
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
select lives_ok(
  $$ select public.reservar_puerto((select id from ids where nombre = 'sol1'), (select id from ids where nombre = 'p1')) $$,
  'Atención reserva un puerto para la solicitud factible');
select is((select estado::text from public.nap_puertos where id = (select id from ids where nombre = 'p1')), 'reservado',
          'El puerto queda reservado');
select ok((select reserva_vence_en > now() + interval '71 hours' from public.solicitudes where id = (select id from ids where nombre = 'sol1')),
          'La reserva vence según el plazo configurado (72 h)');
select throws_ok(
  $$ select public.reservar_puerto((select id from ids where nombre = 'sol2'), (select id from ids where nombre = 'p1')) $$,
  'P0001', null, 'Un puerto reservado no se reserva para otra solicitud');
select public.reservar_puerto((select id from ids where nombre = 'sol2'), (select id from ids where nombre = 'p2'));

reset role;
update public.solicitudes set reserva_vence_en = now() - interval '1 minute' where id = (select id from ids where nombre = 'sol2');
select is(public.liberar_reservas_vencidas(), 1, 'El proceso programado libera las reservas vencidas');
select is((select estado::text from public.nap_puertos where id = (select id from ids where nombre = 'p2')), 'libre',
          'El puerto de la reserva vencida queda libre');
select is((select estado::text from public.solicitudes where id = (select id from ids where nombre = 'sol2')), 'factible',
          'La solicitud vuelve a factible');
set local role authenticated;

-- ---------------- Orden de instalación ----------------
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
select throws_ok(
  $$ select public.generar_orden_instalacion((select id from ids where nombre = 'sol1'), (select id from ids where nombre = 'supervisor'), now()) $$,
  'P0001', null, 'La orden solo se asigna a un técnico');
insert into ids select 'ot1', public.generar_orden_instalacion((select id from ids where nombre = 'sol1'),
                                                               (select id from ids where nombre = 'tecnico'), now() + interval '1 day');
select is((select estado::text from public.ordenes_trabajo where id = (select id from ids where nombre = 'ot1')), 'asignada',
          'La orden con técnico queda asignada');
select is((select estado::text from public.solicitudes where id = (select id from ids where nombre = 'sol1')), 'orden_generada',
          'La solicitud pasa a orden generada');

-- ---------------- Técnico en terreno ----------------
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico2'))::text, true);
select throws_ok(
  $$ select public.cerrar_orden((select id from ids where nombre = 'ot1'), '{"exito": true}') $$,
  '42501', null, 'Otro técnico no puede cerrar la orden');

select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico'))::text, true);
select ok((select contacto_nombre = 'T4 Solicitante' and lat is not null and nap_codigo = 'T4-NAP' and puerto = 1
           from public.ordenes_vista where id = (select id from ids where nombre = 'ot1')),
          'El técnico ve contacto, ubicación, NAP y puerto de su orden');
select lives_ok(
  $$ insert into public.orden_fotos (orden_id, ruta, momento, subida_por)
     values ((select id from ids where nombre = 'ot1'), (select id from ids where nombre = 'ot1')::text || '/antes.jpg', 'antes',
             (select id from ids where nombre = 'tecnico')) $$,
  'El técnico registra una foto de su orden');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('ordenes', (select id from ids where nombre = 'ot1')::text || '/antes.jpg') $$,
  'El técnico sube el archivo de la foto a su carpeta');
select lives_ok(
  $$ update public.ordenes_trabajo set estado = 'en_ejecucion' where id = (select id from ids where nombre = 'ot1') $$,
  'El técnico inicia el trabajo');
select lives_ok(
  $$ select public.cerrar_orden((select id from ids where nombre = 'ot1'),
       '{"exito": true, "potencia_ont_dbm": -19.4, "conformidad_cliente": true, "numero_serie_ont": "ZTEG1234", "lng": -72.0052, "lat": -38.0005}') $$,
  'El técnico cierra la instalación');

reset role;
select ok((select k.estado = 'activo' and k.nap_puerto_id = (select id from ids where nombre = 'p1') and k.numero_serie_ont = 'ZTEG1234'
           from public.clientes k join public.solicitudes s on s.cliente_id = k.id
           where s.id = (select id from ids where nombre = 'sol1')),
          'Al cerrar, se crea el cliente activo con el puerto reservado y su ONT');
select is((select estado::text from public.nap_puertos where id = (select id from ids where nombre = 'p1')), 'ocupado',
          'El puerto reservado pasa a ocupado');
select is((select estado::text from public.solicitudes where id = (select id from ids where nombre = 'sol1')), 'activada',
          'La solicitud queda activada');
select ok((select cliente_id is not null and estado = 'completada' and cerrada_en is not null and potencia_ont_dbm = -19.4
           from public.ordenes_trabajo where id = (select id from ids where nombre = 'ot1')),
          'La orden queda completada, con potencia y ligada al cliente');
select ok(exists (select 1 from public.cliente_historial h join public.solicitudes s on s.cliente_id = h.cliente_id
                  where s.id = (select id from ids where nombre = 'sol1') and h.tipo = 'instalacion'),
          'La instalación queda en el historial del cliente');
set local role authenticated;

select throws_ok(
  $$ select public.cerrar_orden((select id from ids where nombre = 'ot1'), '{"exito": true}') $$,
  'P0001', null, 'Una orden cerrada no se vuelve a cerrar');

-- Instalación fallida: la reserva se mantiene
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
select public.reservar_puerto((select id from ids where nombre = 'sol2'), (select id from ids where nombre = 'p3'));
insert into ids select 'ot2', public.generar_orden_instalacion((select id from ids where nombre = 'sol2'),
                                                               (select id from ids where nombre = 'tecnico2'), now());
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico'))::text, true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('ordenes', (select id from ids where nombre = 'ot2')::text || '/x.jpg') $$,
  '42501', null, 'Un técnico no sube fotos a una orden ajena');
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico2'))::text, true);
select public.cerrar_orden((select id from ids where nombre = 'ot2'), '{"exito": false, "resultado_pruebas": "Sin acceso al domicilio"}');
select ok((select s.estado = 'puerto_reservado' and p.estado = 'reservado'
           from public.solicitudes s join public.nap_puertos p on p.id = s.puerto_reservado_id
           where s.id = (select id from ids where nombre = 'sol2')),
          'Si la instalación falla, la solicitud conserva la reserva para reprogramar');

-- Cancelar la solicitud libera el puerto
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
select lives_ok($$ select public.cancelar_solicitud((select id from ids where nombre = 'sol2'), 'Desistió') $$,
                'Atención cancela la solicitud');
select is((select estado::text from public.nap_puertos where id = (select id from ids where nombre = 'p3')), 'libre',
          'Al cancelar, el puerto reservado queda libre');

-- Órdenes masivas ante una falla
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'supervisor'))::text, true);
select is((public.crear_ordenes_masivas('cable', (select id from public.cables where codigo = 'T4-TR'), 'Corte de troncal') ->> 'creadas')::int, 1,
          'Se crea una orden de reparación por cada cliente afectado');
select is((public.crear_ordenes_masivas('cable', (select id from public.cables where codigo = 'T4-TR'), 'Corte de troncal') ->> 'omitidas')::int, 1,
          'No se duplican órdenes para clientes que ya tienen una reparación abierta');

reset role;
select * from finish();
rollback;
