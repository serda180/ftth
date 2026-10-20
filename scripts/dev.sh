#!/usr/bin/env bash
# Levanta todo el entorno local con un comando:
#   Supabase (Postgres+PostGIS, Auth, API, Studio, correo de pruebas, Edge Functions)
#   + migraciones + datos de demostración + frontend en http://localhost:5173
# Requisitos: Docker, Node 20+ y Supabase CLI (npx la descarga sola).
set -euo pipefail
cd "$(dirname "$0")/.."

SUPABASE="npx --yes supabase@2"

echo "▶ Iniciando Supabase local…"
$SUPABASE start

# Variables para el frontend a partir del estado de Supabase.
eval "$($SUPABASE status -o env | grep -E '^(API_URL|ANON_KEY)=')"
cat > frontend/.env.local <<EOF
VITE_SUPABASE_URL=${API_URL}
VITE_SUPABASE_ANON_KEY=${ANON_KEY}
EOF

echo "▶ Sirviendo Edge Functions…"
$SUPABASE functions serve > .supabase-functions.log 2>&1 &
FUNCIONES_PID=$!
trap 'kill $FUNCIONES_PID 2>/dev/null || true' EXIT

echo "▶ Frontend en http://localhost:5173  ·  Studio en http://127.0.0.1:54323  ·  Correos en http://127.0.0.1:54324"
cd frontend
[ -d node_modules ] || npm install
npm run dev
