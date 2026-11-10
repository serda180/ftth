-- =====================================================================
-- 0014 · Primeros pasos
--
-- Al ingresar por primera vez, el administrador pasa por un asistente para
-- crear su red desde cero (empresa, zona del mapa, planes, OLT, troncal,
-- NAP y equipo) en lugar de partir con datos de demostración.
-- =====================================================================

insert into public.configuracion (clave, valor, descripcion) values
  ('configuracion_inicial', 'false'::jsonb, 'El administrador terminó el asistente de primeros pasos')
on conflict (clave) do nothing;

-- Avance del asistente en una sola consulta. Corre con los permisos de
-- quien llama (las políticas RLS deciden qué cuenta); el asistente solo lo
-- usa un administrador, que ve todo.
create or replace function public.estado_primeros_pasos()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'completo', coalesce((select (valor)::text = 'true' from public.configuracion where clave = 'configuracion_inicial'), false),
    'empresa', coalesce((select length(trim(valor #>> '{}')) > 0 from public.configuracion where clave = 'nombre_empresa'), false),
    'planes', (select count(*) from public.planes where activo and not es_demo),
    'olt', (select count(*) from public.elementos_red where clase = 'olt' and eliminado_en is null and not es_demo),
    'troncales', (select count(*) from public.cables where tipo = 'troncal' and eliminado_en is null and not es_demo),
    'nap', (select count(*) from public.elementos_red where clase = 'nap' and eliminado_en is null and not es_demo),
    'usuarios', (select count(*) from public.perfiles where activo),
    'demo', exists (select 1 from public.elementos_red where es_demo)
         or exists (select 1 from public.clientes where es_demo)
         or exists (select 1 from public.planes where es_demo)
  )
$$;

revoke all on function public.estado_primeros_pasos() from public, anon;
grant execute on function public.estado_primeros_pasos() to authenticated;
