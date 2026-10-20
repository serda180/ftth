-- Pruebas de funciones utilitarias: RUT, teléfono y correlativos.
begin;
select plan(14);

select is(public.rut_calcular_dv(12345678), '5', 'DV de 12.345.678 es 5');
select is(public.rut_calcular_dv(11111111), '1', 'DV de 11.111.111 es 1');
select is(public.rut_calcular_dv(10000013), 'K', 'DV puede ser K');
select is(public.rut_calcular_dv(1000013), '0', 'DV puede ser 0');

select is(public.rut_normalizar('12.345.678-5'), '12345678-5', 'Normaliza RUT con puntos y guion');
select is(public.rut_normalizar(' 10.000.013-k '), '10000013-K', 'Normaliza espacios y k minúscula');
select is(public.rut_normalizar('123456785'), '12345678-5', 'Normaliza RUT sin guion');
select is(public.rut_normalizar('abc'), null::text, 'Texto sin forma de RUT devuelve null');

select ok(public.rut_es_valido('12.345.678-5'), 'RUT con DV correcto es válido');
select ok(not public.rut_es_valido('12.345.678-9'), 'RUT con DV incorrecto es inválido');
select ok(not public.rut_es_valido('0-0'), 'RUT cero es inválido');

select is(public.telefono_normalizar('9 1234 5678'), '+56912345678', 'Normaliza móvil sin código país');
select ok(not public.telefono_es_valido('12345'), 'Teléfono incompleto es inválido');

select ok(public.siguiente_correlativo('TEST') ~ '^TEST-[0-9]{4}-00001$', 'Correlativo con prefijo, año y 5 dígitos');

select * from finish();
rollback;
