#!/usr/bin/env bash
# Prueba de concurrencia: 10 sesiones intentan asignar EL MISMO puerto a
# 10 clientes distintos al mismo tiempo. Solo una debe lograrlo.
#
# Uso: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
#        bash supabase/tests/concurrencia/asignacion_puertos.sh
# Crea sus propios datos (prefijo CONC-) y los elimina al terminar.
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL}"
SESIONES=10
PSQL=(psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -At)

limpiar() {
  "${PSQL[@]}" <<'SQL' >/dev/null
delete from public.clientes where nombre like 'CONC-%';
delete from public.elementos_red where codigo = 'CONC-NAP';
delete from public.usuario_roles where usuario_id in (select id from auth.users where email = 'conc@prueba.test');
delete from auth.users where email = 'conc@prueba.test';
SQL
}
trap limpiar EXIT
limpiar

# Datos de prueba (confirmados, visibles para las otras sesiones)
"${PSQL[@]}" <<SQL >/dev/null
insert into auth.users (id, email) values (gen_random_uuid(), 'conc@prueba.test');
insert into public.usuario_roles (usuario_id, rol) select id, 'atencion_cliente' from auth.users where email = 'conc@prueba.test';
insert into public.elementos_red (codigo, clase, tipo_codigo, ubicacion)
  values ('CONC-NAP', 'nap', 'nap', 'SRID=4326;POINT(-72.5 -37.5)');
insert into public.nap (elemento_id, ratio_splitter_id, capacidad_puertos)
  select id, (select min(id) from public.ratios_splitter), 1 from public.elementos_red where codigo = 'CONC-NAP';
insert into public.clientes (nombre, rut, direccion_calle, comuna_id)
  select 'CONC-' || g, (2000 + g) || '-' || public.rut_calcular_dv(2000 + g), 'Calle', (select min(id) from public.comunas)
  from generate_series(1, $SESIONES) g;
SQL

USUARIO=$("${PSQL[@]}" -c "select id from auth.users where email = 'conc@prueba.test'")
PUERTO=$("${PSQL[@]}" -c "select p.id from public.nap_puertos p join public.elementos_red e on e.id = p.nap_id where e.codigo = 'CONC-NAP'")

# Barrera: una sesión toma un bloqueo exclusivo; las demás esperan con un
# bloqueo compartido y parten todas juntas cuando se libera.
TMP=$(mktemp -d)
( "${PSQL[@]}" -c "select pg_advisory_lock(424242);" -c "select pg_sleep(2);" -c "select pg_advisory_unlock(424242);" >/dev/null ) &
sleep 0.5

for g in $(seq 1 $SESIONES); do
  (
    if "${PSQL[@]}" >/dev/null 2>"$TMP/err$g" <<SQL
select pg_advisory_lock_shared(424242);
select pg_advisory_unlock_shared(424242);
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$USUARIO"}', true);
select public.asignar_puerto_cliente((select id from public.clientes where nombre = 'CONC-$g'), '$PUERTO');
commit;
SQL
    then echo ok > "$TMP/res$g"; else echo error > "$TMP/res$g"; fi
  ) &
done
wait

EXITOS=$(grep -l '^ok$' "$TMP"/res* 2>/dev/null | wc -l | tr -d ' ')
CON_PUERTO=$("${PSQL[@]}" -c "select count(*) from public.clientes where nombre like 'CONC-%' and nap_puerto_id = '$PUERTO'")
ESTADO=$("${PSQL[@]}" -c "select estado from public.nap_puertos where id = '$PUERTO'")
rm -rf "$TMP"

echo "Sesiones: $SESIONES · asignaciones exitosas: $EXITOS · clientes con el puerto: $CON_PUERTO · estado del puerto: $ESTADO"
if [ "$EXITOS" = "1" ] && [ "$CON_PUERTO" = "1" ] && [ "$ESTADO" = "ocupado" ]; then
  echo "ok - solo una sesión obtuvo el puerto"
else
  echo "not ok - la asignación concurrente no es segura"
  exit 1
fi
