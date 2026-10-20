import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { actualizarElemento, crearElemento, type Catalogos, type DatosElemento } from './api';
import { CLASES, ESTADOS, type Clase, type Coordenada, type FichaElemento } from './tipos';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { AreaTexto, Aviso, Boton, Campo, Selector } from '../components/ui';

type CampoDetalle = {
  clave: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'select';
  opciones?: { valor: string; texto: string }[];
  soloAlCrear?: boolean;
  requerido?: boolean;
  ayuda?: string;
};

function camposDetalle(clase: Clase, cat: Catalogos): CampoDetalle[] {
  const ratios = cat.ratios.map((r) => ({ valor: String(r.id), texto: `${r.ratio} (${r.perdida_db} dB)` }));
  switch (clase) {
    case 'nap':
      return [
        { clave: 'ratio_splitter_id', etiqueta: 'Splitter', tipo: 'select', opciones: ratios, requerido: true },
        { clave: 'capacidad_puertos', etiqueta: 'Puertos', tipo: 'numero', ayuda: 'Por defecto, una salida del splitter por puerto.' },
        { clave: 'modelo', etiqueta: 'Modelo de caja', tipo: 'texto' },
      ];
    case 'olt':
      return [
        { clave: 'marca', etiqueta: 'Marca', tipo: 'texto' },
        { clave: 'modelo', etiqueta: 'Modelo', tipo: 'texto' },
        {
          clave: 'tecnologia',
          etiqueta: 'Tecnología',
          tipo: 'select',
          opciones: ['GPON', 'XG-PON', 'XGS-PON', 'EPON'].map((t) => ({ valor: t, texto: t })),
        },
        { clave: 'numero_serie', etiqueta: 'N.º de serie', tipo: 'texto' },
        { clave: 'ip_gestion', etiqueta: 'IP de gestión', tipo: 'texto' },
        { clave: 'puertos_pon', etiqueta: 'Puertos PON', tipo: 'numero', soloAlCrear: true, ayuda: 'Se crean como PON 0/1, 0/2…' },
      ];
    case 'poste':
      return [
        {
          clave: 'material',
          etiqueta: 'Material',
          tipo: 'select',
          opciones: [
            { valor: 'hormigon', texto: 'Hormigón' },
            { valor: 'madera', texto: 'Madera' },
            { valor: 'metal', texto: 'Metal' },
            { valor: 'otro', texto: 'Otro' },
          ],
        },
        { clave: 'altura_m', etiqueta: 'Altura (m)', tipo: 'numero' },
        { clave: 'propietario', etiqueta: 'Propietario', tipo: 'texto', ayuda: 'Ej.: la empresa eléctrica dueña del poste.' },
        { clave: 'numero_placa', etiqueta: 'N.º de placa', tipo: 'texto' },
      ];
    case 'camara':
      return [
        { clave: 'tipo', etiqueta: 'Tipo', tipo: 'texto' },
        { clave: 'dimensiones', etiqueta: 'Dimensiones', tipo: 'texto' },
      ];
    case 'caja_empalme':
      return [
        { clave: 'modelo', etiqueta: 'Modelo', tipo: 'texto' },
        { clave: 'capacidad_empalmes', etiqueta: 'Capacidad de empalmes', tipo: 'numero' },
      ];
    case 'splitter':
      return [{ clave: 'ratio_splitter_id', etiqueta: 'Ratio', tipo: 'select', opciones: ratios, requerido: true }];
    case 'gabinete':
      return [{ clave: 'descripcion', etiqueta: 'Descripción', tipo: 'texto' }];
    case 'punto_ingreso':
      return [
        { clave: 'edificio', etiqueta: 'Edificio', tipo: 'texto' },
        { clave: 'pisos', etiqueta: 'Pisos', tipo: 'numero' },
        { clave: 'contacto_administracion', etiqueta: 'Contacto de administración', tipo: 'texto' },
      ];
    default:
      return [];
  }
}

const PREFIJO: Record<string, string> = {
  olt: 'OLT', nap: 'NAP', cto: 'CTO', poste: 'P', camara: 'CAM', caja_empalme: 'CE',
  splitter: 'SPL', gabinete: 'GAB', punto_ingreso: 'PI', punto_distribucion: 'PD',
};

/** Siguiente código libre del tipo, ej. NAP-014. */
async function sugerirCodigo(tipo: string): Promise<string> {
  const prefijo = PREFIJO[tipo] ?? tipo.toUpperCase().slice(0, 4);
  const { data } = await supabase
    .from('elementos_red')
    .select('codigo')
    .ilike('codigo', `${prefijo}-%`)
    .is('eliminado_en', null)
    .order('codigo', { ascending: false })
    .limit(50);
  const numeros = (data ?? [])
    .map((r: { codigo: string }) => Number(/^[A-Z]+-(\d+)$/i.exec(r.codigo)?.[1] ?? NaN))
    .filter((n) => Number.isFinite(n));
  const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1;
  return `${prefijo}-${String(siguiente).padStart(3, '0')}`;
}

export function FormElemento({
  catalogos,
  clase,
  tipoCodigo,
  punto,
  ficha,
  alCambiarPunto,
  alGuardar,
  alCancelar,
}: {
  catalogos: Catalogos;
  clase: Clase;
  tipoCodigo: string;
  punto: Coordenada;
  /** Si viene, se edita ese elemento; si no, se crea uno nuevo. */
  ficha?: FichaElemento;
  alCambiarPunto: (c: Coordenada) => void;
  alGuardar: (id: string) => void;
  alCancelar: () => void;
}) {
  const nuevo = !ficha;
  const campos = camposDetalle(clase, catalogos);
  const tiposDeClase = catalogos.tipos.filter((t) => t.clase === clase);

  const [d, setD] = useState<Omit<DatosElemento, 'lng' | 'lat' | 'clase'>>(() => ({
    tipo_codigo: ficha?.tipo_codigo ?? tipoCodigo,
    codigo: ficha?.codigo ?? '',
    nombre: ficha?.nombre ?? '',
    direccion: ficha?.direccion ?? '',
    comuna_id: ficha?.comuna_id ?? null,
    sector: ficha?.sector ?? '',
    estado: ficha?.estado ?? 'operativo',
    fecha_instalacion: ficha?.fecha_instalacion ?? '',
    observaciones: ficha?.observaciones ?? '',
    detalle: Object.fromEntries(
      campos.map((c) => [c.clave, ficha?.detalle[c.clave] != null ? String(ficha.detalle[c.clave]) : '']),
    ),
  }));
  const [capacidadTocada, setCapacidadTocada] = useState(!nuevo);

  useEffect(() => {
    if (nuevo && !d.codigo) {
      void sugerirCodigo(d.tipo_codigo).then((codigo) => setD((x) => (x.codigo ? x : { ...x, codigo })));
    }
    // Solo al abrir el formulario o al cambiar el tipo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.tipo_codigo]);

  const guardar = useMutation({
    mutationFn: async () => {
      const datos: DatosElemento = { ...d, clase, lng: punto[0], lat: punto[1] };
      if (ficha) {
        await actualizarElemento(ficha.id, datos);
        return ficha.id;
      }
      return crearElemento(datos);
    },
    onSuccess: (id) => alGuardar(id),
  });

  const det = (k: string) => d.detalle[k] ?? '';
  const setDet = (k: string, v: string) => {
    setD((x) => {
      const detalle = { ...x.detalle, [k]: v };
      // Al elegir el splitter de una NAP se sugiere la cantidad de puertos.
      if (clase === 'nap' && k === 'ratio_splitter_id' && !capacidadTocada) {
        const r = catalogos.ratios.find((r) => String(r.id) === v);
        if (r) detalle.capacidad_puertos = String(r.salidas);
      }
      return { ...x, detalle };
    });
    if (k === 'capacidad_puertos') setCapacidadTocada(true);
  };

  const faltantes = campos.filter((c) => c.requerido && !det(c.clave)).map((c) => c.etiqueta);
  const codigoValido = /^[A-Za-z0-9._-]{2,40}$/.test(d.codigo);

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!codigoValido || faltantes.length) return;
    guardar.mutate();
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <header>
        <p className="text-sm text-tenue">{CLASES.find((c) => c.valor === clase)?.nombre}</p>
        <h2 className="font-cond text-2xl font-semibold">{ficha ? `Editar ${ficha.codigo}` : 'Nuevo elemento'}</h2>
        {nuevo && (
          <p className="mt-1 text-sm text-tenue">Arrastre el punto naranjo en el mapa para ajustar la ubicación.</p>
        )}
      </header>

      {tiposDeClase.length > 1 && (
        <Selector
          id="el-tipo"
          etiqueta="Tipo"
          value={d.tipo_codigo}
          onChange={(e) => setD({ ...d, tipo_codigo: e.target.value })}
          opciones={tiposDeClase.map((t) => ({ valor: t.codigo, texto: t.nombre }))}
        />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Campo
          id="el-codigo"
          etiqueta="Código"
          value={d.codigo}
          onChange={(e) => setD({ ...d, codigo: e.target.value.toUpperCase() })}
          error={d.codigo && !codigoValido ? 'Use letras, números, guion o punto (2 a 40).' : undefined}
          autoComplete="off"
        />
        <Selector
          id="el-estado"
          etiqueta="Estado"
          value={d.estado}
          onChange={(e) => setD({ ...d, estado: e.target.value as DatosElemento['estado'] })}
          opciones={ESTADOS.map((x) => ({ valor: x.valor, texto: x.nombre }))}
        />
      </div>
      <Campo id="el-nombre" etiqueta="Nombre o referencia" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} />

      {campos.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {campos
            .filter((c) => nuevo || !c.soloAlCrear)
            .map((c) =>
              c.tipo === 'select' ? (
                <Selector
                  key={c.clave}
                  id={`el-${c.clave}`}
                  etiqueta={c.etiqueta}
                  value={det(c.clave)}
                  onChange={(e) => setDet(c.clave, e.target.value)}
                  opciones={c.opciones ?? []}
                  vacio={c.requerido ? 'Elegir…' : 'Sin especificar'}
                  ayuda={c.ayuda}
                />
              ) : (
                <Campo
                  key={c.clave}
                  id={`el-${c.clave}`}
                  etiqueta={c.etiqueta}
                  type={c.tipo === 'numero' ? 'number' : 'text'}
                  inputMode={c.tipo === 'numero' ? 'decimal' : undefined}
                  min={c.tipo === 'numero' ? 0 : undefined}
                  value={det(c.clave)}
                  onChange={(e) => setDet(c.clave, e.target.value)}
                  ayuda={c.ayuda}
                />
              ),
            )}
        </div>
      )}

      <Campo id="el-direccion" etiqueta="Dirección o referencia" value={d.direccion} onChange={(e) => setD({ ...d, direccion: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <Selector
          id="el-comuna"
          etiqueta="Comuna"
          value={d.comuna_id ?? ''}
          onChange={(e) => setD({ ...d, comuna_id: e.target.value ? Number(e.target.value) : null })}
          opciones={catalogos.comunas.map((c) => ({ valor: c.id, texto: c.nombre }))}
          vacio="Sin especificar"
        />
        <Campo id="el-sector" etiqueta="Sector" value={d.sector} onChange={(e) => setD({ ...d, sector: e.target.value })} />
      </div>
      {nuevo ? (
        <div className="grid grid-cols-2 gap-3">
          <Campo
            id="el-lat"
            etiqueta="Latitud"
            type="number"
            step="0.000001"
            value={punto[1]}
            onChange={(e) => e.target.value && alCambiarPunto([punto[0], Number(e.target.value)])}
          />
          <Campo
            id="el-lng"
            etiqueta="Longitud"
            type="number"
            step="0.000001"
            value={punto[0]}
            onChange={(e) => e.target.value && alCambiarPunto([Number(e.target.value), punto[1]])}
          />
        </div>
      ) : (
        <p className="text-sm text-tenue">
          Ubicación <span className="cifra">{punto[1].toFixed(6)}, {punto[0].toFixed(6)}</span>. Para cambiarla use
          «Mover» en la ficha.
        </p>
      )}
      <Campo
        id="el-fecha"
        etiqueta="Fecha de instalación"
        type="date"
        value={d.fecha_instalacion}
        onChange={(e) => setD({ ...d, fecha_instalacion: e.target.value })}
      />
      <AreaTexto
        id="el-obs"
        etiqueta="Observaciones técnicas"
        value={d.observaciones}
        onChange={(e) => setD({ ...d, observaciones: e.target.value })}
      />

      {faltantes.length > 0 && <p className="text-sm text-tenue">Falta completar: {faltantes.join(', ')}.</p>}
      {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error)}</Aviso>}
      <div className="flex gap-3">
        <Boton type="submit" cargando={guardar.isPending} disabled={!codigoValido || faltantes.length > 0}>
          {nuevo ? 'Crear elemento' : 'Guardar cambios'}
        </Boton>
        <Boton type="button" variante="secundario" onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
