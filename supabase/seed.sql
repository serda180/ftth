-- =====================================================================
-- DATOS DE DEMOSTRACIÓN — NO SON DATOS REALES
-- =====================================================================
-- Todos los registros llevan es_demo = true y nombres que empiezan con
-- "DEMO". Se cargan solos en desarrollo (supabase db reset) y NO se
-- aplican en producción. Para borrarlos:
--   select public.eliminar_datos_demo();
-- Ubicaciones ficticias en el centro de Concepción.

-- Planes
insert into public.planes (nombre, bajada_mbps, subida_mbps, precio_clp, descripcion, es_demo) values
  ('DEMO Hogar 300',  300, 150, 14990, 'Plan de demostración', true),
  ('DEMO Hogar 600',  600, 300, 19990, 'Plan de demostración', true),
  ('DEMO Pyme 940',   940, 470, 34990, 'Plan de demostración', true);

-- OLT con dos puertos PON
with e as (
  insert into public.elementos_red (codigo, clase, tipo_codigo, nombre, ubicacion, direccion, comuna_id, sector, es_demo)
  values ('DEMO-OLT-01', 'olt', 'olt', 'DEMO OLT central',
          'SRID=4326;POINT(-73.0503 -36.8270)', 'DEMO Sala técnica',
          (select id from public.comunas where nombre = 'Concepción'), 'Centro', true)
  returning id
)
insert into public.olts (elemento_id, marca, modelo, tecnologia)
select id, 'DEMO', 'OLT de demostración', 'GPON' from e;

insert into public.olt_puertos_pon (olt_id, slot, puerto, etiqueta)
select e.id, 0, g, 'PON 0/' || g
from public.elementos_red e, generate_series(1, 2) g
where e.codigo = 'DEMO-OLT-01';

-- Tres NAP con splitter interno
insert into public.elementos_red (codigo, clase, tipo_codigo, nombre, ubicacion, direccion, comuna_id, sector, es_demo)
select v.codigo, 'nap', 'nap', v.nombre, v.geo::geography, v.dir,
       (select id from public.comunas where nombre = 'Concepción'), 'Centro', true
from (values
  ('DEMO-NAP-001', 'DEMO NAP Barros Arana',  'SRID=4326;POINT(-73.0478 -36.8262)', 'DEMO Barros Arana con Caupolicán'),
  ('DEMO-NAP-002', 'DEMO NAP Freire',        'SRID=4326;POINT(-73.0451 -36.8251)', 'DEMO Freire con Lincoyán'),
  ('DEMO-NAP-003', 'DEMO NAP Maipú',         'SRID=4326;POINT(-73.0425 -36.8243)', 'DEMO Maipú con Orompello')
) v(codigo, nombre, geo, dir);

insert into public.nap (elemento_id, ratio_splitter_id, capacidad_puertos, modelo)
select e.id, r.id, r.salidas, 'DEMO NAP exterior'
from public.elementos_red e
join public.ratios_splitter r on r.ratio = case e.codigo when 'DEMO-NAP-003' then '1:16' else '1:8' end
where e.codigo like 'DEMO-NAP-%';

-- Cable troncal de 24 fibras que pasa por las tres NAP
insert into public.cables (codigo, nombre_tramo, tipo, modelo_cable_id, cantidad_fibras, origen_id, destino_id,
                           trazado, longitud_declarada_m, es_demo)
values ('DEMO-TR-01', 'DEMO Troncal centro', 'troncal',
        (select id from public.modelos_cable where nombre = 'ADSS 24F'), 24,
        (select id from public.elementos_red where codigo = 'DEMO-OLT-01'),
        (select id from public.elementos_red where codigo = 'DEMO-NAP-003'),
        'SRID=4326;LINESTRING(-73.0503 -36.8270, -73.0478 -36.8262, -73.0451 -36.8251, -73.0425 -36.8243)',
        800, true);

-- Conexiones: PON 0/1 inyecta los hilos 1..3; cada hilo alimenta una NAP
insert into public.conexiones (tipo, olt_puerto_pon_id, hilo_destino_id, confirmada, es_demo)
select 'inyeccion_olt', p.id, h.id, true, true
from public.cable_hilos h
join public.cables c on c.id = h.cable_id and c.codigo = 'DEMO-TR-01'
join public.olt_puertos_pon p on p.etiqueta = 'PON 0/1'
where h.numero between 1 and 3;

insert into public.conexiones (tipo, hilo_origen_id, elemento_id, confirmada, es_demo)
select 'alimentacion_nap', h.id, e.id, h.numero <> 3, true
from public.cable_hilos h
join public.cables c on c.id = h.cable_id and c.codigo = 'DEMO-TR-01'
join public.elementos_red e on e.codigo = 'DEMO-NAP-00' || h.numero
where h.numero between 1 and 3;

update public.cable_hilos h set estado = 'en_uso'
from public.cables c
where c.id = h.cable_id and c.codigo = 'DEMO-TR-01' and h.numero between 1 and 3;

-- Clientes (RUT con dígito verificador válido, generado; no son personas reales)
insert into public.clientes (nombre, rut, telefono, email, direccion_calle, direccion_numero, comuna_id,
                             ubicacion, plan_id, precio_mensual_clp, fecha_contratacion, estado, es_demo)
select 'DEMO Cliente ' || g,
       (1000 + g) || '-' || public.rut_calcular_dv(1000 + g),
       '+5690000000' || g,
       'demo' || g || '@ejemplo.cl',
       'DEMO Calle ' || g, (100 + g)::text,
       (select id from public.comunas where nombre = 'Concepción'),
       ('SRID=4326;POINT(' || (-73.0480 + g * 0.0004) || ' ' || (-36.8265 + g * 0.0002) || ')')::geography,
       (select id from public.planes where nombre = case when g % 2 = 0 then 'DEMO Hogar 600' else 'DEMO Hogar 300' end),
       case when g % 2 = 0 then 19990 else 14990 end,
       (current_date - (g * 35))::date,
       case when g = 5 then 'suspendido'::public.estado_cliente else 'activo'::public.estado_cliente end,
       true
from generate_series(1, 5) g;

-- Conectar los clientes 1..5 a los puertos 1..5 de DEMO-NAP-001
update public.clientes c
set nap_puerto_id = p.id
from public.nap_puertos p
join public.elementos_red e on e.id = p.nap_id and e.codigo = 'DEMO-NAP-001'
where c.es_demo and p.numero = substring(c.nombre from '[0-9]+$')::int;

update public.nap_puertos p set estado = 'ocupado'
from public.elementos_red e
where e.id = p.nap_id and e.codigo = 'DEMO-NAP-001' and p.numero between 1 and 5;

update public.nap_puertos p set estado = 'averiado', observaciones = 'DEMO conector dañado'
from public.elementos_red e
where e.id = p.nap_id and e.codigo = 'DEMO-NAP-002' and p.numero = 8;

-- Solicitudes
insert into public.solicitudes (estado, canal, nombre, telefono, direccion_calle, direccion_numero, comuna_id,
                                ubicacion, plan_id, es_demo)
values
  ('nueva', 'whatsapp', 'DEMO Interesado 1', '+56911111111', 'DEMO Pasaje', '12',
   (select id from public.comunas where nombre = 'Concepción'),
   'SRID=4326;POINT(-73.0440 -36.8247)', (select id from public.planes where nombre = 'DEMO Hogar 300'), true),
  ('en_factibilidad', 'telefono', 'DEMO Interesado 2', '+56922222222', 'DEMO Avenida', '450',
   (select id from public.comunas where nombre = 'Concepción'),
   'SRID=4326;POINT(-73.0430 -36.8240)', (select id from public.planes where nombre = 'DEMO Hogar 600'), true);

-- Órdenes de trabajo (sin técnico asignado: aún no existen usuarios)
insert into public.ordenes_trabajo (tipo, prioridad, estado, cliente_id, direccion, descripcion, es_demo)
select 'reparacion', 'alta', 'pendiente', c.id, c.direccion_calle || ' ' || c.direccion_numero,
       'DEMO Cliente sin servicio, revisar potencia', true
from public.clientes c where c.nombre = 'DEMO Cliente 3';

insert into public.ordenes_trabajo (tipo, prioridad, estado, solicitud_id, direccion, descripcion, es_demo)
select 'instalacion', 'media', 'pendiente', s.id, s.direccion_calle || ' ' || s.direccion_numero,
       'DEMO Instalación nueva', true
from public.solicitudes s where s.nombre = 'DEMO Interesado 2';

-- Inventario
insert into public.proveedores (nombre, contacto, es_demo) values ('DEMO Proveedor de fibra', 'DEMO Contacto', true);

insert into public.articulos (codigo, nombre, categoria, unidad, es_serializado, stock_minimo, es_demo) values
  ('DEMO-DROP-1F', 'DEMO Cable drop 1 fibra',      'acometida', 'metro',  false, 500, true),
  ('DEMO-CONN-SC', 'DEMO Conector rápido SC/APC',  'conector',  'unidad', false, 50,  true),
  ('DEMO-ONT-01',  'DEMO ONT GPON',                'ont',       'unidad', true,  5,   true);

-- Dos compras del conector a distinto precio: el costo queda en el más alto
insert into public.movimientos_inventario (tipo, articulo_id, cantidad, bodega_destino_id, precio_compra_clp,
                                           proveedor_id, documento, es_demo)
select 'entrada_compra', a.id, v.cant, (select id from public.bodegas where nombre = 'Bodega central'),
       v.precio, (select id from public.proveedores where nombre = 'DEMO Proveedor de fibra'), v.doc, true
from (values
  ('DEMO-DROP-1F', 300::numeric, 180, 'DEMO Factura 1001'),
  ('DEMO-CONN-SC', 40::numeric,  300, 'DEMO Factura 1001'),
  ('DEMO-CONN-SC', 40::numeric,  350, 'DEMO Factura 1002')
) v(cod, cant, precio, doc)
join public.articulos a on a.codigo = v.cod;
