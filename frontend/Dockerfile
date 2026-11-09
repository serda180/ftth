# --- Compilación ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

# --- Servidor ---
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.d/40-config-supabase.sh
# Quita retornos de carro por si el repositorio se descargó en Windows con CRLF.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-config-supabase.sh \
 && chmod +x /docker-entrypoint.d/40-config-supabase.sh \
 && mkdir -p /etc/nginx/api.d
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/salud || exit 1
