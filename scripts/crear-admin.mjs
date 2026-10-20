#!/usr/bin/env node
// Crea un usuario con contraseña y le asigna un rol (por defecto, administrador).
// Sirve para el primer administrador y, mientras no haya correo (SMTP)
// configurado, para crear usuarios sin invitación.
// Uso:
//   SUPABASE_URL=https://api.tu-dominio.cl SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/crear-admin.mjs correo@empresa.cl "Nombre Apellido" [rol]
// Roles: administrador, supervisor_red, tecnico, atencion_cliente, inventario
// La contraseña se pide por consola (no queda en el historial del shell).
// Requiere Node 18 o superior. No necesita instalar dependencias.
import { createInterface } from 'node:readline';

const ROLES = ['administrador', 'supervisor_red', 'tecnico', 'atencion_cliente', 'inventario'];
const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const claveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const [email, nombre = '', rol = 'administrador'] = process.argv.slice(2);

if (!url || !claveServicio || !email) {
  console.error('Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node crear-usuario.mjs correo "Nombre" [rol]');
  process.exit(1);
}
if (!ROLES.includes(rol)) {
  console.error(`Rol no válido: ${rol}. Use uno de: ${ROLES.join(', ')}`);
  process.exit(1);
}

function preguntarOculto(texto) {
  return new Promise((resolver) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(texto)) rl.output.write(s);
    };
    rl.question(texto, (r) => {
      rl.close();
      process.stdout.write('\n');
      resolver(r);
    });
  });
}

const cabeceras = {
  apikey: claveServicio,
  Authorization: `Bearer ${claveServicio}`,
  'Content-Type': 'application/json',
};

const clave = await preguntarOculto('Contraseña (mínimo 8 caracteres): ');
if (clave.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

let r1;
try {
  r1 = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify({
      email,
      password: clave,
      email_confirm: true,
      user_metadata: { nombre_completo: nombre },
    }),
  });
} catch (e) {
  console.error(`No se pudo conectar con ${url}. Revise la dirección y que Supabase esté en línea.`, e.cause?.message ?? '');
  process.exit(1);
}
const usuario = await r1.json().catch(() => ({}));
if (!r1.ok) {
  console.error('No se pudo crear el usuario:', usuario.msg ?? usuario.message ?? `HTTP ${r1.status}`);
  process.exit(1);
}

const r2 = await fetch(`${url}/rest/v1/usuario_roles`, {
  method: 'POST',
  headers: { ...cabeceras, Prefer: 'return=minimal' },
  body: JSON.stringify({ usuario_id: usuario.id, rol }),
});
if (!r2.ok) {
  console.error('Usuario creado, pero no se pudo asignar el rol:', await r2.text());
  console.error('¿Ejecutó antes 01_base_de_datos.sql en el SQL Editor?');
  process.exit(1);
}

console.log(`Usuario creado: ${email} (${rol}). Ya puede ingresar con esa contraseña.`);
