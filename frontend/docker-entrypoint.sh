#!/bin/sh
# Genera /config.js con la configuración pública al arrancar el contenedor.
# Así la misma imagen sirve para cualquier entorno (variables de Dokploy).
# Solo se usan valores PÚBLICOS: nunca pasar aquí la service_role key.
set -eu

: "${SUPABASE_URL:?Falta la variable SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?Falta la variable SUPABASE_ANON_KEY}"

# Escapar comillas simples y barras para insertarlos en JavaScript.
escapar() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g"; }

cat > /usr/share/nginx/html/config.js <<EOF
window.__CONFIG__ = {
  SUPABASE_URL: '$(escapar "$SUPABASE_URL")',
  SUPABASE_ANON_KEY: '$(escapar "$SUPABASE_ANON_KEY")',
};
EOF

# La política de seguridad de contenido permite conectar solo con Supabase.
ORIGEN_API=$(printf '%s' "$SUPABASE_URL" | sed -E 's#^(https?://[^/]+).*#\1#')
ORIGEN_WS=$(printf '%s' "$ORIGEN_API" | sed -E 's#^http#ws#')
sed -i "s#__ORIGEN_API__#${ORIGEN_API} ${ORIGEN_WS}#g" /etc/nginx/conf.d/default.conf
