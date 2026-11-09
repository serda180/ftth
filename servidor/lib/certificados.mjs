// Autoridad certificadora local y certificado del sitio, sin dependencias.
//
// La raíz (10 años) se instala una vez en cada PC y celular. El certificado
// del sitio (800 días, dentro del límite de Apple para CAs privadas) cubre
// todas las IP del PC servidor y su nombre, y se regenera solo si cambian.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------
// DER mínimo
// ---------------------------------------------------------------------
function largo(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (etiqueta, contenido) => Buffer.concat([Buffer.from([etiqueta]), largo(contenido.length), contenido]);
const secuencia = (...partes) => tlv(0x30, Buffer.concat(partes));
const conjunto = (...partes) => tlv(0x31, Buffer.concat(partes));
const explicito = (n, contenido) => tlv(0xa0 + n, contenido);
const octetos = (buf) => tlv(0x04, buf);
const utf8 = (texto) => tlv(0x0c, Buffer.from(texto, 'utf8'));
const booleano = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));

function entero(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && (b[1] & 0x80) === 0) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

function oid(texto) {
  const n = texto.split('.').map(Number);
  const bytes = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) {
    const grupo = [v & 0x7f];
    let x = v >> 7;
    while (x > 0) {
      grupo.unshift((x & 0x7f) | 0x80);
      x >>= 7;
    }
    bytes.push(...grupo);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function bits(buf, sinUsar = 0) {
  return tlv(0x03, Buffer.concat([Buffer.from([sinUsar]), buf]));
}

/** KeyUsage: posiciones de bit según RFC 5280 (0 = digitalSignature). */
function usosDeClave(posiciones) {
  let valor = 0;
  for (const p of posiciones) valor |= 0x80 >> p;
  let sinUsar = 0;
  while (sinUsar < 7 && (valor & (1 << sinUsar)) === 0) sinUsar++;
  return bits(Buffer.from([valor]), sinUsar);
}

function fecha(d) {
  // UTCTime hasta 2049, GeneralizedTime desde 2050 (RFC 5280).
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

const nombre = (cn, o) =>
  secuencia(
    conjunto(secuencia(oid('2.5.4.10'), utf8(o))),
    conjunto(secuencia(oid('2.5.4.3'), utf8(cn))),
  );

const extension = (id, critica, valor) =>
  critica ? secuencia(oid(id), booleano(true), octetos(valor)) : secuencia(oid(id), octetos(valor));

const ALG_FIRMA = secuencia(oid('1.2.840.10045.4.3.2')); // ecdsa-with-SHA256

function idClave(spkiDer) {
  // SHA-1 del valor del BIT STRING de la clave pública (método 1 de RFC 5280).
  // En P-256 el SPKI termina con 03 42 00 || 04 X Y: la clave son los últimos 65 bytes.
  return createHash('sha1').update(spkiDer.subarray(spkiDer.length - 65)).digest();
}

function emitir({ sujeto, emisor, clavePublica, claveFirma, dias, extensiones }) {
  const publica = clavePublica.type === 'public' ? clavePublica : createPublicKey(clavePublica);
  const spki = publica.export({ type: 'spki', format: 'der' });
  const desde = new Date(Date.now() - 60 * 60 * 1000);
  const hasta = new Date(desde.getTime() + dias * 24 * 60 * 60 * 1000);
  const tbs = secuencia(
    explicito(0, entero(Buffer.from([2]))),
    entero(Buffer.concat([Buffer.from([0x40]), randomBytes(15)])),
    ALG_FIRMA,
    emisor,
    secuencia(fecha(desde), fecha(hasta)),
    sujeto,
    spki,
    explicito(3, secuencia(...extensiones(spki))),
  );
  const firma = sign('sha256', tbs, claveFirma);
  const der = secuencia(tbs, ALG_FIRMA, bits(firma));
  return { der, pem: aPem(der, 'CERTIFICATE'), hasta };
}

function aPem(der, tipo) {
  const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${tipo}-----\n${b64}\n-----END ${tipo}-----\n`;
}

function ipBytes(ip) {
  return Buffer.from(ip.split('.').map(Number));
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------
export function direccionesLocales() {
  const ips = new Set(['127.0.0.1']);
  for (const lista of Object.values(networkInterfaces())) {
    for (const d of lista ?? []) if (d.family === 'IPv4' && !d.internal) ips.add(d.address);
  }
  return [...ips].sort();
}

function nombresLocales() {
  const h = hostname().toLowerCase();
  return [...new Set(['localhost', h, `${h}.local`])].filter((n) => /^[a-z0-9.-]+$/.test(n));
}

/**
 * Asegura raíz y certificado del sitio en `carpeta`. Devuelve {key, cert, raiz}
 * en PEM, listos para https.createServer.
 */
export function asegurarCertificados(carpeta, avisar = () => {}) {
  mkdirSync(carpeta, { recursive: true });
  const rutaRaiz = join(carpeta, 'raiz.crt');
  const rutaClaveRaiz = join(carpeta, 'raiz.key');
  const rutaSitio = join(carpeta, 'sitio.crt');
  const rutaClaveSitio = join(carpeta, 'sitio.key');
  const rutaInfo = join(carpeta, 'sitio.json');

  if (!existsSync(rutaRaiz) || !existsSync(rutaClaveRaiz)) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const sujeto = nombre(`Plataforma FTTH - Autoridad local (${hostname()})`, 'Plataforma FTTH');
    const raiz = emitir({
      sujeto,
      emisor: sujeto,
      clavePublica: publicKey,
      claveFirma: privateKey,
      dias: 3650,
      extensiones: (spki) => [
        extension('2.5.29.19', true, secuencia(booleano(true))),
        extension('2.5.29.15', true, usosDeClave([5, 6])),
        extension('2.5.29.14', false, octetos(idClave(spki))),
      ],
    });
    writeFileSync(rutaClaveRaiz, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(rutaRaiz, raiz.pem);
    avisar('Se creó la autoridad certificadora local');
  }

  const ips = direccionesLocales();
  const nombres = nombresLocales();
  let info = null;
  try {
    info = JSON.parse(readFileSync(rutaInfo, 'utf8'));
  } catch {
    info = null;
  }
  const vigente =
    info &&
    existsSync(rutaSitio) &&
    existsSync(rutaClaveSitio) &&
    JSON.stringify(info.ips) === JSON.stringify(ips) &&
    JSON.stringify(info.nombres) === JSON.stringify(nombres) &&
    new Date(info.hasta).getTime() - Date.now() > 60 * 24 * 60 * 60 * 1000;

  if (!vigente) {
    const claveRaiz = createPrivateKey(readFileSync(rutaClaveRaiz));
    const certRaizDer = Buffer.from(
      readFileSync(rutaRaiz, 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
      'base64',
    );
    const emisor = extraerSujeto(certRaizDer);
    const spkiRaiz = createPublicKey(claveRaiz).export({ type: 'spki', format: 'der' });
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const nombresAlt = Buffer.concat([
      ...nombres.map((n) => tlv(0x82, Buffer.from(n, 'ascii'))),
      ...ips.map((ip) => tlv(0x87, ipBytes(ip))),
    ]);
    const sitio = emitir({
      sujeto: nombre(ips.find((i) => i !== '127.0.0.1') ?? 'localhost', 'Plataforma FTTH'),
      emisor,
      clavePublica: publicKey,
      claveFirma: claveRaiz,
      dias: 800,
      extensiones: (spki) => [
        extension('2.5.29.19', true, secuencia()),
        extension('2.5.29.15', true, usosDeClave([0])),
        extension('2.5.29.37', false, secuencia(oid('1.3.6.1.5.5.7.3.1'))),
        extension('2.5.29.17', false, tlv(0x30, nombresAlt)),
        extension('2.5.29.14', false, octetos(idClave(spki))),
        extension('2.5.29.35', false, secuencia(tlv(0x80, idClave(spkiRaiz)))),
      ],
    });
    writeFileSync(rutaClaveSitio, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(rutaSitio, sitio.pem);
    writeFileSync(rutaInfo, JSON.stringify({ ips, nombres, hasta: sitio.hasta }, null, 2));
    avisar(`Certificado del sitio para ${[...ips, ...nombres].join(', ')}`);
  }

  const raiz = readFileSync(rutaRaiz, 'utf8');
  return {
    key: readFileSync(rutaClaveSitio, 'utf8'),
    // Cadena completa: sitio + raíz.
    cert: readFileSync(rutaSitio, 'utf8') + raiz,
    raiz,
    ips,
  };
}

// Sujeto (Name) de un certificado DER: 6.º elemento del TBSCertificate.
function extraerSujeto(der) {
  const leer = (buf, pos) => {
    let p = pos + 1;
    let n = buf[p++];
    if (n & 0x80) {
      const k = n & 0x7f;
      n = 0;
      for (let i = 0; i < k; i++) n = (n << 8) | buf[p++];
    }
    return { inicio: pos, contenido: p, fin: p + n };
  };
  const cert = leer(der, 0);
  const tbs = leer(der, cert.contenido);
  let pos = tbs.contenido;
  const elementos = [];
  while (pos < tbs.fin) {
    const e = leer(der, pos);
    elementos.push(der.subarray(e.inicio, e.fin));
    pos = e.fin;
  }
  // [0] versión, serie, algoritmo, emisor, validez, sujeto
  return elementos[5];
}
