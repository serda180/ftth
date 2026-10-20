-- Pruebas de inventario: costo más alto de compra, stock, consumo del técnico.
begin;
select plan(16);

create temp table ids (nombre text primary key, id uuid not null);
grant select on ids to authenticated;
insert into auth.users (id, email) values
  (gen_random_uuid(), 'bodega@test.cl'), (gen_random_uuid(), 'tecnico@test.cl'), (gen_random_uuid(), 'admin@test.cl');
insert into ids select split_part(email, '@', 1), id from auth.users where email like '%@test.cl';
insert into public.usuario_roles (usuario_id, rol) values
  ((select id from ids where nombre = 'bodega'), 'inventario'),
  ((select id from ids where nombre = 'tecnico'), 'tecnico'),
  ((select id from ids where nombre = 'admin'), 'administrador');

insert into public.planes (nombre, bajada_mbps, subida_mbps, precio_clp) values ('T Plan', 100, 50, 10000);
insert into public.clientes (nombre, rut, direccion_calle, comuna_id, plan_id, estado)
values ('T Cliente', '12.345.678-5', 'Calle 1', (select min(id) from public.comunas),
        (select id from public.planes where nombre = 'T Plan'), 'activo');
insert into public.ordenes_trabajo (tipo, estado, cliente_id, tecnico_id, descripcion)
values ('instalacion', 'en_ejecucion', (select id from public.clientes where nombre = 'T Cliente'),
        (select id from ids where nombre = 'tecnico'), 'Instalación de prueba');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'bodega'))::text, true);

select is((select tipo::text from public.bodegas where tecnico_id = (select id from ids where nombre = 'tecnico')),
          'tecnico', 'Al asignar el rol de técnico se crea su bodega');
insert into public.articulos (codigo, nombre, categoria, unidad, costo_unitario_clp)
values ('T-CONN', 'Conector prueba', 'conector', 'unidad', 99999);
select is((select costo_unitario_clp from public.articulos where codigo = 'T-CONN'), 0,
          'Un artículo nuevo parte con costo 0 aunque se indique otro');

insert into public.movimientos_inventario (tipo, articulo_id, cantidad, bodega_destino_id, precio_compra_clp)
values ('entrada_compra', (select id from public.articulos where codigo = 'T-CONN'), 100,
        (select id from public.bodegas where nombre = 'Bodega central'), 300);
insert into public.movimientos_inventario (tipo, articulo_id, cantidad, bodega_destino_id, precio_compra_clp)
values ('entrada_compra', (select id from public.articulos where codigo = 'T-CONN'), 50,
        (select id from public.bodegas where nombre = 'Bodega central'), 350);
select is((select costo_unitario_clp from public.articulos where codigo = 'T-CONN'), 350,
          'Una compra más cara sube el costo');

insert into public.movimientos_inventario (tipo, articulo_id, cantidad, bodega_destino_id, precio_compra_clp)
values ('entrada_compra', (select id from public.articulos where codigo = 'T-CONN'), 50,
        (select id from public.bodegas where nombre = 'Bodega central'), 280);
select is((select costo_unitario_clp from public.articulos where codigo = 'T-CONN'), 350,
          'Una compra más barata no baja el costo');
select is((select costo_unitario_clp from public.movimientos_inventario where precio_compra_clp = 280), 350,
          'El movimiento guarda el costo vigente aplicado');
select is((select cantidad from public.stock s join public.articulos a on a.id = s.articulo_id
           where a.codigo = 'T-CONN'), 200.00::numeric(12,2), 'Las compras suman stock en bodega central');

select throws_ok(
  $$ update public.articulos set costo_unitario_clp = 100 where codigo = 'T-CONN' $$,
  '42501', null, 'Inventario no puede editar el costo directamente');
select throws_ok(
  $$ update public.movimientos_inventario set cantidad = 1 $$,
  '42501', null, 'Los movimientos no se pueden modificar');

insert into public.movimientos_inventario (tipo, articulo_id, cantidad, bodega_origen_id, bodega_destino_id)
values ('traspaso', (select id from public.articulos where codigo = 'T-CONN'), 20,
        (select id from public.bodegas where nombre = 'Bodega central'),
        (select id from public.bodegas where tecnico_id = (select id from ids where nombre = 'tecnico')));
select throws_ok(
  $$ insert into public.movimientos_inventario (tipo, articulo_id, cantidad, bodega_origen_id, motivo)
     values ('salida', (select id from public.articulos where codigo = 'T-CONN'), 1000,
             (select id from public.bodegas where nombre = 'Bodega central'), 'prueba') $$,
  '23514', null, 'No se puede sacar más de lo disponible');

-- ---- técnico ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'tecnico'))::text, true);
select is((select count(*)::int from public.stock), 1, 'El técnico ve solo el stock de su bodega');
select lives_ok(
  $$ insert into public.movimientos_inventario (tipo, articulo_id, cantidad, bodega_origen_id, orden_id)
     values ('consumo_ot', (select id from public.articulos where codigo = 'T-CONN'), 2,
             public.mi_bodega_id(), (select id from public.ordenes_trabajo)) $$,
  'El técnico registra consumo de su bodega en su orden');
select is((select cantidad from public.stock), 18.00::numeric(12,2), 'El consumo descuenta del stock del técnico');
select throws_ok(
  $$ insert into public.movimientos_inventario (tipo, articulo_id, cantidad, bodega_origen_id, orden_id)
     values ('consumo_ot', (select id from public.articulos where codigo = 'T-CONN'), 2,
             (select id from public.bodegas where nombre = 'Bodega central'), (select id from public.ordenes_trabajo)) $$,
  '42501', null, 'El técnico no puede consumir desde la bodega central');
select throws_ok(
  $$ insert into public.movimientos_inventario (tipo, articulo_id, cantidad, bodega_destino_id, precio_compra_clp)
     values ('entrada_compra', (select id from public.articulos where codigo = 'T-CONN'), 5, public.mi_bodega_id(), 1) $$,
  '42501', null, 'El técnico no puede registrar compras');

-- ---- administrador ----
select set_config('request.jwt.claims', json_build_object('sub', (select id from ids where nombre = 'admin'))::text, true);
select lives_ok(
  $$ select public.ajustar_costo_articulo((select id from public.articulos where codigo = 'T-CONN'), 320,
                                          'Error de digitación en factura') $$,
  'El administrador ajusta el costo con motivo');
select is((select costo_nuevo_clp from public.articulo_costo_ajustes), 320, 'El ajuste queda registrado');

reset role;
select * from finish();
rollback;
