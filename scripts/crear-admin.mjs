#!/usr/bin/env node
// Crea el primer usuario administrador.
// Uso:
//   SUPABASE_URL=https://api.tu-dominio.cl SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/crear-admin.mjs correo@empresa.cl "Nombre Apellido"
// La contraseña se pide por consola (no queda en el historial del shell).
// Requiere Node 18 o superior. No necesita instalar dependencias.
import { createInterface } from 'node:readline';

const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const claveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const [email, nombre = ''] = process.argv.slice(2);

if (!url || !claveServicio || !email) {
  console.error('Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/crear-admin.mjs correo "Nombre"');
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

const r1 = await fetch(`${url}/auth/v1/admin/users`, {
  method: 'POST',
  headers: cabeceras,
  body: JSON.stringify({
    email,
    password: clave,
    email_confirm: true,
    user_metadata: { nombre_completo: nombre },
  }),
});
const usuario = await r1.json();
if (!r1.ok) {
  console.error('No se pudo crear el usuario:', usuario.msg ?? usuario.message ?? JSON.stringify(usuario));
  process.exit(1);
}

const r2 = await fetch(`${url}/rest/v1/usuario_roles`, {
  method: 'POST',
  headers: { ...cabeceras, Prefer: 'return=minimal' },
  body: JSON.stringify({ usuario_id: usuario.id, rol: 'administrador' }),
});
if (!r2.ok) {
  console.error('Usuario creado, pero no se pudo asignar el rol:', await r2.text());
  process.exit(1);
}

console.log(`Administrador creado: ${email}`);
