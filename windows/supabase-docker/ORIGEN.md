# Supabase self-hosted (copia fija)

Archivos copiados sin modificar desde la carpeta `docker/` del repositorio oficial
[supabase/supabase](https://github.com/supabase/supabase), commit `156738417b699a499d1a1504b86fcc0459ec5a8c`
(9 de noviembre de 2026). Licencia Apache-2.0 (`LICENSE-supabase`).

Se incluyen solo los archivos que usa la instalación en Windows (gateway Envoy,
scripts de inicialización de la base, router de Edge Functions y Supavisor).
Los cambios propios de la plataforma FTTH están en `../docker-compose.ftth.yml`,
nunca en estos archivos, para poder actualizarlos reemplazando la carpeta.
