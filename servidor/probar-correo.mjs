#!/usr/bin/env node
// Envía un correo de prueba con la configuración SMTP de config.json.
// Uso: node probar-correo.mjs <config.json> <destinatario>
import { readFileSync } from 'node:fs';
import { enviarCorreo } from './lib/smtp.mjs';

const [rutaConfig, para] = process.argv.slice(2);
if (!rutaConfig || !para) {
  console.error('Uso: node probar-correo.mjs <config.json> <destinatario>');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(rutaConfig, 'utf8').replace(/^﻿/, ''));
if (!cfg.smtp?.host) {
  console.error('No hay servidor de correo configurado en config.json');
  process.exit(2);
}
try {
  await enviarCorreo(cfg.smtp, {
    para,
    asunto: 'Prueba de correo de la Plataforma FTTH',
    texto: 'Si recibió este mensaje, la Plataforma FTTH ya puede enviar invitaciones y enlaces de recuperación.\n',
  });
  console.log(`Correo de prueba enviado a ${para}`);
} catch (e) {
  console.error(`No se pudo enviar: ${e.message}`);
  process.exit(1);
}
