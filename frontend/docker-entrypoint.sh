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

# Proxy interno hacia Supabase (opcional). Con API_INTERNA=http://api-gw:8000 la
# aplicación y la API quedan en la misma dirección (instalación en Windows).
mkdir -p /etc/nginx/api.d
rm -f /etc/nginx/api.d/api.conf
if [ -n "${API_INTERNA:-}" ]; then
  if ! printf '%s' "$API_INTERNA" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'; then
    echo "API_INTERNA no válida: $API_INTERNA (ejemplo: http://api-gw:8000)" >&2
    exit 1
  fi
  cat > /etc/nginx/api.d/api.conf <<EOF
location ~ ^/(auth|rest|storage|functions|graphql|realtime)/v1/ {
  # Resolver de Docker: si el gateway se reinicia con otra IP, se vuelve a resolver.
  resolver 127.0.0.11 valid=10s ipv6=off;
  set \$api_interna ${API_INTERNA};
  proxy_pass \$api_interna;
  proxy_http_version 1.1;
  proxy_set_header Host \$host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-Host \$host;
  proxy_set_header Upgrade \$http_upgrade;
  proxy_set_header Connection \$http_connection;
  client_max_body_size 50m;
  proxy_read_timeout 300s;
  proxy_request_buffering off;
}
EOF
  echo "Proxy hacia Supabase activo: ${API_INTERNA}"
fi
