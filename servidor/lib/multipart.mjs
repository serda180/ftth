// Lectura de multipart/form-data (subida de fotos con supabase-js).
// Devuelve el primer campo que trae archivo: { nombreCampo, tipo, datos }.

export function extraerArchivo(cuerpo, tipoContenido) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(tipoContenido ?? '');
  if (!m) return null;
  const limite = Buffer.from(`--${m[1] ?? m[2].trim()}`);
  let pos = cuerpo.indexOf(limite);
  while (pos !== -1) {
    pos += limite.length;
    // "--" tras el delimitador marca el final.
    if (cuerpo[pos] === 0x2d && cuerpo[pos + 1] === 0x2d) return null;
    if (cuerpo[pos] === 0x0d && cuerpo[pos + 1] === 0x0a) pos += 2;
    const finCabeceras = cuerpo.indexOf('\r\n\r\n', pos);
    if (finCabeceras === -1) return null;
    const cabeceras = cuerpo.subarray(pos, finCabeceras).toString('utf8');
    const inicioDatos = finCabeceras + 4;
    const siguiente = cuerpo.indexOf(limite, inicioDatos);
    if (siguiente === -1) return null;
    // Los datos terminan en CRLF antes del siguiente delimitador.
    const datos = cuerpo.subarray(inicioDatos, siguiente - 2);
    const disposicion = /content-disposition:([^\r\n]*)/i.exec(cabeceras)?.[1] ?? '';
    if (/filename\*?=/i.test(disposicion)) {
      return {
        nombreCampo: /name="([^"]*)"/i.exec(disposicion)?.[1] ?? '',
        tipo: (/content-type:\s*([^\r\n;]+)/i.exec(cabeceras)?.[1] ?? 'application/octet-stream').trim().toLowerCase(),
        datos,
      };
    }
    pos = siguiente;
  }
  return null;
}
