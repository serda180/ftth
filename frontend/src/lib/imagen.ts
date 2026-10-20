// Reduce las fotos en el teléfono antes de subirlas: menos datos móviles y
// subidas más rápidas desde terreno.

/** Dimensiones finales manteniendo la proporción, sin agrandar. */
export function dimensionesAjustadas(ancho: number, alto: number, maximo: number): { ancho: number; alto: number } {
  const escala = Math.min(1, maximo / Math.max(ancho, alto));
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
}

export async function comprimirImagen(archivo: File, maximo = 1600, calidad = 0.8): Promise<Blob> {
  // createImageBitmap respeta la orientación EXIF en los navegadores actuales.
  const imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  const { ancho, alto } = dimensionesAjustadas(imagen.width, imagen.height, maximo);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite procesar la imagen');
  ctx.drawImage(imagen, 0, 0, ancho, alto);
  imagen.close();
  return new Promise((resolver, rechazar) =>
    lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo comprimir la foto'))), 'image/jpeg', calidad),
  );
}
