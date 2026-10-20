-- Pruebas de indicadores del panel y de la limpieza de datos de demostración.
begin;
select plan(9);

create temp table ids (nombre text primary key, id uuid not null);
grant select on ids to authenticated;
create temp table antes (d jsonb);
grant all on antes to authenticated;
insert into auth.users (id, email) values
  (gen_random_uuid(), 'atencion@test.cl'), (gen_random_uuid(), 'tecnico@test.cl'), (gen_random_uuid(), 'admin@test.cl');
insert into ids select split_part(email, '@', 1), id from auth.users where email like '%@test.cl';
insert into public.usuario_roles (usuario_id, rol) values
  ((select id from ids where nombre = 'atencion'), 'atencion_cliente'),
  ((select id from ids where nombre = 'tecnico'), 'tecnico'),
  ((select id from ids where nombre = 'admin'), 'administrador');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);
insert into antes select public.dashboard_indicadores();

reset role;
create temp view delta as
  select (d1 #>> '{clientes,activos}')::int     - (d0 #>> '{clientes,activos}')::int     as activos,
         (d1 #>> '{clientes,suspendidos}')::int - (d0 #>> '{clientes,suspendidos}')::int as suspendidos,
         (d1 ->> 'ingreso_mensual_clp')::int    - (d0 ->> 'ingreso_mensual_clp')::int    as ingreso,
         (d1 #>> '{nap,total}')::int            - (d0 #>> '{nap,total}')::int            as naps,
         (d1 #>> '{nap,sobre_alerta}')::int     - (d0 #>> '{nap,sobre_alerta}')::int     as alerta,
         (d1 #>> '{puertos,ocupados}')::int     - (d0 #>> '{puertos,ocupados}')::int     as ocupados
  from (select public.dashboard_indicadores() d1) a, (select d as d0 from antes) b;
grant select on delta to authenticated;
insert into public.planes (nombre, bajada_mbps, subida_mbps, precio_clp) values ('T Plan', 100, 50, 10000);
insert into public.clientes (nombre, rut, direccion_calle, comuna_id, plan_id, estado, fecha_contratacion)
values ('T Activo', '12.345.678-5', 'Calle 1', (select min(id) from public.comunas),
        (select id from public.planes where nombre = 'T Plan'), 'activo', current_date),
       ('T Suspendido', '11.111.111-1', 'Calle 2', (select min(id) from public.comunas),
        (select id from public.planes where nombre = 'T Plan'), 'suspendido', current_date);
insert into public.elementos_red (codigo, clase, tipo_codigo, ubicacion)
values ('T-NAP-D', 'nap', 'nap', 'SRID=4326;POINT(-73.05 -36.82)');
insert into public.nap (elemento_id, ratio_splitter_id, capacidad_puertos)
select id, (select id from public.ratios_splitter where ratio = '1:4'), 4 from public.elementos_red where codigo = 'T-NAP-D';
update public.nap_puertos set estado = 'ocupado'
where nap_id = (select id from public.elementos_red where codigo = 'T-NAP-D') and numero <= 4;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'atencion'))::text, true);


select is((select activos from delta), 1, 'Cuenta el nuevo cliente activo');
select is((select suspendidos from delta), 1, 'Cuenta el nuevo cliente suspendido');
select is((select ingreso from delta), 10000, 'El ingreso mensual suma solo clientes activos');
select is((select naps from delta), 1, 'Cuenta la nueva NAP');
select is((select alerta from delta), 1, 'Una NAP llena aparece sobre el umbral de alerta');
select is((select ocupados from delta), 4, 'Cuenta los puertos ocupados');
select is(jsonb_array_length(public.dashboard_indicadores() -> 'serie_mensual'), 12,
          'La serie mensual trae 12 meses');

select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico'))::text, true);
select throws_ok($$ select public.dashboard_indicadores() $$, '42501', null,
                 'Un técnico no accede a los indicadores generales');

select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'admin'))::text, true);
select public.eliminar_datos_demo();
reset role;
select is((select count(*)::int from public.elementos_red where es_demo)
        + (select count(*)::int from public.clientes where es_demo)
        + (select count(*)::int from public.movimientos_inventario where es_demo), 0,
          'eliminar_datos_demo borra todos los registros de demostración');

select * from finish();
rollback;
