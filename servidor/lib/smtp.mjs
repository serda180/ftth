// Cliente SMTP mínimo (sin dependencias) para invitaciones y recuperación.
// Soporta TLS directo (puerto 465) y STARTTLS (587/25), AUTH PLAIN/LOGIN.
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

function lector(socket) {
  let bufer = '';
  const pendientes = [];
  const despachar = () => {
    while (pendientes.length) {
      // Respuesta completa: última línea "NNN texto" (sin guion tras el código).
      const lineas = bufer.split('\r\n');
      let fin = -1;
      for (let i = 0; i < lineas.length - 1; i++) {
        if (/^\d{3} /.test(lineas[i]) || /^\d{3}$/.test(lineas[i])) {
          fin = i;
          break;
        }
      }
      if (fin < 0) return;
      const respuesta = lineas.slice(0, fin + 1);
      bufer = lineas.slice(fin + 1).join('\r\n');
      pendientes.shift().resolver({ codigo: Number(respuesta[fin].slice(0, 3)), texto: respuesta.join('\n') });
    }
  };
  const alDatos = (d) => {
    bufer += d.toString('utf8');
    despachar();
  };
  socket.on('data', alDatos);
  return {
    leer: () =>
      new Promise((resolver, rechazar) => {
        pendientes.push({ resolver, rechazar });
        despachar();
      }),
    soltar: () => socket.off('data', alDatos),
  };
}

const codificarCabecera = (t) => (/^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`);

/**
 * Envía un correo de texto. config: {host, puerto, seguro: 'tls'|'starttls'|'no',
 * usuario, clave, remitente, nombre}
 */
export async function enviarCorreo(config, { para, asunto, texto }) {
  const puerto = Number(config.puerto ?? (config.seguro === 'tls' ? 465 : 587));
  const modo = config.seguro ?? (puerto === 465 ? 'tls' : 'starttls');
  const tiempo = 20000;

  let socket = await new Promise((resolver, rechazar) => {
    const s =
      modo === 'tls'
        ? tls.connect({ host: config.host, port: puerto, servername: config.host }, () => resolver(s))
        : net.connect({ host: config.host, port: puerto }, () => resolver(s));
    s.setTimeout(tiempo, () => s.destroy(new Error('Tiempo de espera agotado con el servidor de correo')));
    s.once('error', rechazar);
  });
  let canal = lector(socket);

  const esperar = async (codigos) => {
    const r = await canal.leer();
    if (!codigos.includes(r.codigo)) throw new Error(`El servidor de correo respondió: ${r.texto}`);
    return r;
  };
  const enviar = (linea) => socket.write(`${linea}\r\n`);

  try {
    await esperar([220]);
    enviar('EHLO plataforma-ftth');
    let ehlo = await esperar([250]);

    if (modo === 'starttls') {
      enviar('STARTTLS');
      await esperar([220]);
      canal.soltar();
      socket = await new Promise((resolver, rechazar) => {
        const s = tls.connect({ socket, servername: config.host }, () => resolver(s));
        s.once('error', rechazar);
      });
      canal = lector(socket);
      enviar('EHLO plataforma-ftth');
      ehlo = await esperar([250]);
    }

    if (config.usuario) {
      if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo.texto)) {
        enviar(`AUTH PLAIN ${Buffer.from(`\0${config.usuario}\0${config.clave ?? ''}`, 'utf8').toString('base64')}`);
        await esperar([235]);
      } else {
        enviar('AUTH LOGIN');
        await esperar([334]);
        enviar(Buffer.from(config.usuario, 'utf8').toString('base64'));
        await esperar([334]);
        enviar(Buffer.from(config.clave ?? '', 'utf8').toString('base64'));
        await esperar([235]);
      }
    }

    const remitente = config.remitente ?? config.usuario;
    enviar(`MAIL FROM:<${remitente}>`);
    await esperar([250]);
    enviar(`RCPT TO:<${para}>`);
    await esperar([250, 251]);
    enviar('DATA');
    await esperar([354]);

    const dominio = String(remitente).split('@')[1] ?? 'plataforma-ftth';
    const mensaje = [
      `From: ${codificarCabecera(config.nombre ?? 'Plataforma FTTH')} <${remitente}>`,
      `To: <${para}>`,
      `Subject: ${codificarCabecera(asunto)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@${dominio}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(texto, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd(),
    ].join('\r\n');
    socket.write(`${mensaje}\r\n.\r\n`);
    await esperar([250]);
    enviar('QUIT');
  } finally {
    socket.end();
  }
}
