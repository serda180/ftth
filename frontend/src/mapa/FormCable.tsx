import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { actualizarCable, crearCable, type Catalogos, type DatosCable } from './api';
import { ESTADOS, TIPOS_CABLE, type Coordenada, type FichaCable, type TipoCable } from './tipos';
import { formatearDistancia, longitudM } from './geo';
import { mensajeError } from '../lib/errores';
import { AreaTexto, Aviso, Boton, Campo, Selector } from '../components/ui';

export type Candidato = { id: string; codigo: string; tipo_nombre: string; distancia: number };

export function FormCable({
  catalogos,
  puntos,
  ficha,
  candidatosOrigen,
  candidatosDestino,
  alGuardar,
  alCancelar,
}: {
  catalogos: Catalogos;
  /** Trazado dibujado (cable nuevo) o actual (edición). */
  puntos: Coordenada[];
  ficha?: FichaCable;
  candidatosOrigen: Candidato[];
  candidatosDestino: Candidato[];
  alGuardar: (id: string) => void;
  alCancelar: () => void;
}) {
  const nuevo = !ficha;
  const [d, setD] = useState<DatosCable>(() => ({
    codigo: ficha?.codigo ?? '',
    nombre_tramo: ficha?.nombre_tramo ?? '',
    tipo: ficha?.tipo ?? 'troncal',
    modelo_cable_id: ficha?.modelo_cable_id ?? null,
    cantidad_fibras: ficha?.cantidad_fibras ?? null,
    // Para un cable nuevo se proponen los elementos más cercanos a cada extremo.
    origen_id: ficha ? (ficha.origen?.id ?? null) : (candidatosOrigen[0]?.id ?? null),
    destino_id: ficha ? (ficha.destino?.id ?? null) : (candidatosDestino[0]?.id ?? null),
    longitud_declarada_m: ficha?.longitud_declarada_m ?? null,
    estado: ficha?.estado ?? 'operativo',
    fecha_instalacion: ficha?.fecha_instalacion ?? '',
    observaciones: ficha?.observaciones ?? '',
  }));

  const guardar = useMutation({
    mutationFn: async () => {
      if (ficha) {
        // Sin coordenadas: el trazado se conserva y solo se reajustan los extremos.
        await actualizarCable(ficha.id, d);
        return ficha.id;
      }
      return crearCable({ ...d, coordenadas: puntos });
    },
    onSuccess: (id) => alGuardar(id),
  });

  const codigoValido = /^[A-Za-z0-9._-]{2,40}$/.test(d.codigo);
  const fibrasValidas = d.modelo_cable_id != null || (d.cantidad_fibras != null && d.cantidad_fibras >= 1);

  // Opciones de origen/destino: candidatos cercanos más el valor actual si no está entre ellos.
  function opciones(candidatos: Candidato[], actual: { id: string; codigo: string } | null | undefined) {
    const lista = candidatos.map((c) => ({
      valor: c.id,
      texto: `${c.codigo} (${c.tipo_nombre}, a ${formatearDistancia(c.distancia)})`,
    }));
    if (actual && !lista.some((o) => o.valor === actual.id)) lista.unshift({ valor: actual.id, texto: actual.codigo });
    return lista;
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!codigoValido || !fibrasValidas) return;
    guardar.mutate();
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <header>
        <p className="text-sm text-tenue">Cable</p>
        <h2 className="font-cond text-2xl font-semibold">{ficha ? `Editar ${ficha.codigo}` : 'Nuevo cable'}</h2>
        <p className="mt-1 text-sm text-tenue">
          Largo dibujado: <span className="cifra font-semibold text-tinta">{formatearDistancia(longitudM(puntos))}</span>
          {nuevo && ' · El largo definitivo lo calcula el servidor.'}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Campo
          id="ca-codigo"
          etiqueta="Código"
          value={d.codigo}
          onChange={(e) => setD({ ...d, codigo: e.target.value.toUpperCase() })}
          error={d.codigo && !codigoValido ? 'Use letras, números, guion o punto (2 a 40).' : undefined}
          autoComplete="off"
        />
        <Selector
          id="ca-tipo"
          etiqueta="Tipo"
          value={d.tipo}
          onChange={(e) => setD({ ...d, tipo: e.target.value as TipoCable })}
          opciones={TIPOS_CABLE.map((t) => ({ valor: t.valor, texto: t.nombre }))}
        />
      </div>
      <Campo id="ca-nombre" etiqueta="Nombre del tramo" value={d.nombre_tramo} onChange={(e) => setD({ ...d, nombre_tramo: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <Selector
          id="ca-modelo"
          etiqueta="Modelo"
          value={d.modelo_cable_id ?? ''}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            const m = catalogos.modelos.find((x) => x.id === id);
            setD({ ...d, modelo_cable_id: id, cantidad_fibras: m ? m.cantidad_fibras : d.cantidad_fibras });
          }}
          opciones={catalogos.modelos.map((m) => ({ valor: m.id, texto: m.nombre }))}
          vacio="Sin modelo"
        />
        <Campo
          id="ca-fibras"
          etiqueta="Cantidad de fibras"
          type="number"
          min={1}
          inputMode="numeric"
          value={d.cantidad_fibras ?? ''}
          onChange={(e) => setD({ ...d, cantidad_fibras: e.target.value ? Number(e.target.value) : null })}
          ayuda={!nuevo ? 'Si reduce la cantidad, los hilos sobrantes deben estar libres.' : undefined}
        />
      </div>
      <Selector
        id="ca-origen"
        etiqueta="Origen"
        value={d.origen_id ?? ''}
        onChange={(e) => setD({ ...d, origen_id: e.target.value || null })}
        opciones={opciones(candidatosOrigen, ficha?.origen)}
        vacio="Sin elemento de origen"
        ayuda="El extremo del cable queda unido exactamente a este elemento."
      />
      <Selector
        id="ca-destino"
        etiqueta="Destino"
        value={d.destino_id ?? ''}
        onChange={(e) => setD({ ...d, destino_id: e.target.value || null })}
        opciones={opciones(candidatosDestino, ficha?.destino)}
        vacio="Sin elemento de destino"
      />
      {d.origen_id && d.origen_id === d.destino_id && (
        <Aviso tipo="error">El origen y el destino deben ser elementos distintos.</Aviso>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Campo
          id="ca-largo"
          etiqueta="Largo declarado (m)"
          type="number"
          min={0}
          inputMode="decimal"
          value={d.longitud_declarada_m ?? ''}
          onChange={(e) => setD({ ...d, longitud_declarada_m: e.target.value ? Number(e.target.value) : null })}
          ayuda="Incluye reservas y flojas."
        />
        <Selector
          id="ca-estado"
          etiqueta="Estado"
          value={d.estado}
          onChange={(e) => setD({ ...d, estado: e.target.value as DatosCable['estado'] })}
          opciones={ESTADOS.map((x) => ({ valor: x.valor, texto: x.nombre }))}
        />
      </div>
      <Campo
        id="ca-fecha"
        etiqueta="Fecha de instalación"
        type="date"
        value={d.fecha_instalacion}
        onChange={(e) => setD({ ...d, fecha_instalacion: e.target.value })}
      />
      <AreaTexto
        id="ca-obs"
        etiqueta="Observaciones técnicas"
        value={d.observaciones}
        onChange={(e) => setD({ ...d, observaciones: e.target.value })}
      />

      {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error)}</Aviso>}
      <div className="flex gap-3">
        <Boton
          type="submit"
          cargando={guardar.isPending}
          disabled={!codigoValido || !fibrasValidas || (d.origen_id != null && d.origen_id === d.destino_id)}
        >
          {nuevo ? 'Crear cable' : 'Guardar cambios'}
        </Boton>
        <Boton type="button" variante="secundario" onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
