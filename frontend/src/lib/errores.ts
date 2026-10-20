// Traduce errores de Supabase/PostgreSQL a mensajes útiles en español.

type ErrorConCodigo = { code?: string; message?: string; status?: number };

const POR_MENSAJE: [RegExp, string][] = [
  [/invalid login credentials/i, 'El correo o la contraseña no son correctos.'],
  [/email not confirmed/i, 'Debe confirmar su correo antes de ingresar.'],
  [/user is banned/i, 'Su cuenta está desactivada. Contacte a un administrador.'],
  [/password should be at least/i, 'La contraseña debe tener al menos 8 caracteres.'],
  [/new password should be different/i, 'La nueva contraseña debe ser distinta de la anterior.'],
  [/rate limit|too many requests/i, 'Demasiados intentos. Espere unos minutos y vuelva a intentar.'],
  [/already been registered|already registered/i, 'Ya existe un usuario con ese correo.'],
  [/failed to fetch|networkerror/i, 'No hay conexión con el servidor. Revise su conexión a internet.'],
];

export function mensajeError(error: unknown): string {
  if (!error) return '';
  const e = error as ErrorConCodigo;
  const msg = e.message ?? String(error);

  for (const [re, texto] of POR_MENSAJE) {
    if (re.test(msg)) return texto;
  }
  switch (e.code) {
    case '42501':
      // Los errores de permisos propios ya vienen en español desde la base.
      return /row-level security|permission denied/i.test(msg)
        ? 'No tiene permiso para realizar esta acción.'
        : msg;
    case '23505':
      return 'Ya existe un registro con esos datos.';
    case '23503':
      return 'El registro está relacionado con otros datos y no se puede completar la acción.';
    case '23514':
    case 'P0001':
      return msg;
    default:
      return msg || 'Ocurrió un error inesperado.';
  }
}
