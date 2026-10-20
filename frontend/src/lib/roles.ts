export type Rol = 'administrador' | 'supervisor_red' | 'tecnico' | 'atencion_cliente' | 'inventario';

export const ROLES: { valor: Rol; nombre: string; descripcion: string }[] = [
  { valor: 'administrador', nombre: 'Administrador', descripcion: 'Acceso completo, usuarios y configuración' },
  { valor: 'supervisor_red', nombre: 'Supervisor de red', descripcion: 'Infraestructura y factibilidad' },
  { valor: 'atencion_cliente', nombre: 'Atención al cliente', descripcion: 'Clientes y solicitudes' },
  { valor: 'tecnico', nombre: 'Técnico', descripcion: 'Sus órdenes de trabajo en terreno' },
  { valor: 'inventario', nombre: 'Inventario', descripcion: 'Materiales, bodegas y movimientos' },
];

export function nombreRol(rol: Rol): string {
  return ROLES.find((r) => r.valor === rol)?.nombre ?? rol;
}

/** Igual que public.tiene_rol: el administrador siempre cumple. */
export function tieneRol(roles: Rol[], ...requeridos: Rol[]): boolean {
  if (roles.includes('administrador')) return true;
  return requeridos.some((r) => roles.includes(r));
}

/** Roles que pueden ver el panel de indicadores (dashboard_indicadores). */
export const ROLES_PANEL: Rol[] = ['supervisor_red', 'atencion_cliente', 'inventario'];
