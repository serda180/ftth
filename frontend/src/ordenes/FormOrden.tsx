import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { mensajeError } from '../lib/errores';
import { supabase } from '../lib/supabase';
import { AreaTexto, Aviso, Boton, Campo, EncabezadoPagina, Selector } from '../components/ui';
import { PRIORIDADES, TIPOS_ORDEN, crearOrden, tecnicosActivos, type Prioridad, type TipoOrden } from './api';

type ClienteBuscado = { id: string; codigo: string; nombre: string; direccion_calle: string; direccion_numero: string | null; comuna_id: number; comuna: string | null; estado: string };

/** Orden para un cliente existente. Las instalaciones nacen desde una solicitud. */
export function FormOrden() {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [busqueda, setBusqueda] = useState('');
  const [consulta, setConsulta] = useState('');
  const [cliente, setCliente] = useState<ClienteBuscado | null>(null);
  const [tipo, setTipo] = useState<TipoOrden>('reparacion');
  const [prioridad, setPrioridad] = useState<Prioridad>('media');
  const [tecnico, setTecnico] = useState('');
  const [fecha, setFecha] = useState('');
  const [descripcion, setDescripcion] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setConsulta(busqueda.trim()), 300);
    return () => window.clearTimeout(t);
  }, [busqueda]);

  // Si se llega desde la ficha del cliente: /ordenes/nueva?cliente=<id>
  const preCliente = params.get('cliente');
  useEffect(() => {
    if (!preCliente) return;
    void supabase
      .from('clientes_vista')
      .select('id, codigo, nombre, direccion_calle, direccion_numero, comuna_id, comuna, estado')
      .eq('id', preCliente)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCliente(data as ClienteBuscado);
      });
  }, [preCliente]);

  const resultados = useQuery({
    queryKey: ['ordenes', 'buscar-cliente', consulta],
    enabled: consulta.length >= 2 && !cliente,
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes_vista')
        .select('id, codigo, nombre, direccion_calle, direccion_numero, comuna_id, comuna, estado')
        .ilike('texto_busqueda', `%${consulta.toLowerCase().replace(/[%,()]/g, ' ')}%`)
        .neq('estado', 'retirado').limit(8);
      if (error) throw error;
      return data as ClienteBuscado[];
    },
  });
  const tecnicos = useQuery({ queryKey: ['ordenes', 'tecnicos'], queryFn: tecnicosActivos });

  const guardar = useMutation({
    mutationFn: () =>
      crearOrden(
        { tipo, prioridad, cliente_id: cliente!.id, descripcion: descripcion.trim(), tecnico_id: tecnico || null, fecha_programada: fecha ? new Date(fecha).toISOString() : null },
        { direccion: [cliente!.direccion_calle, cliente!.direccion_numero].filter(Boolean).join(' '), comuna_id: cliente!.comuna_id },
      ),
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: ['ordenes'] });
      navegar(`/ordenes/${id}`);
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (cliente && descripcion.trim().length >= 3) guardar.mutate();
  }

  return (
    <>
      <EncabezadoPagina titulo="Nueva orden de trabajo" detalle="Para instalaciones nuevas, genere la orden desde la solicitud." />
      <form onSubmit={enviar} className="flex max-w-2xl flex-col gap-4" noValidate>
        {cliente ? (
          <div className="flex items-start justify-between gap-3 rounded-md border border-linea bg-superficie p-3">
            <div>
              <p className="font-medium">{cliente.nombre} <span className="cifra text-sm text-tenue">{cliente.codigo}</span></p>
              <p className="text-sm text-tenue">{[cliente.direccion_calle, cliente.direccion_numero].filter(Boolean).join(' ')}, {cliente.comuna}</p>
            </div>
            <button type="button" className="text-sm text-acento hover:underline" onClick={() => setCliente(null)}>Cambiar</button>
          </div>
        ) : (
          <div className="relative">
            <Campo id="o-cliente" etiqueta="Cliente" placeholder="Buscar por nombre, RUT, código o dirección" value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)} autoComplete="off" />
            {resultados.data && resultados.data.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-linea bg-superficie py-1 shadow-lg">
                {resultados.data.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="w-full px-3 py-2 text-left hover:bg-fondo" onClick={() => setCliente(c)}>
                      <span className="font-medium">{c.nombre}</span>{' '}
                      <span className="text-sm text-tenue">{c.codigo} · {c.direccion_calle} {c.direccion_numero}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Selector id="o-tipo" etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoOrden)}
            opciones={TIPOS_ORDEN.filter((t) => t.valor !== 'instalacion').map((t) => ({ valor: t.valor, texto: t.nombre }))} />
          <Selector id="o-prio" etiqueta="Prioridad" value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)}
            opciones={PRIORIDADES.map((p) => ({ valor: p.valor, texto: p.nombre }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Selector id="o-tec" etiqueta="Técnico" value={tecnico} vacio="Asignar después" onChange={(e) => setTecnico(e.target.value)}
            opciones={(tecnicos.data ?? []).map((t) => ({ valor: t.id, texto: `${t.nombre} (${t.abiertas} abiertas)` }))} />
          <Campo id="o-fecha" etiqueta="Fecha y hora" type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <AreaTexto id="o-desc" etiqueta="Descripción del problema o trabajo" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        {guardar.isError && <Aviso tipo="error">{mensajeError(guardar.error)}</Aviso>}
        <div className="flex gap-3">
          <Boton type="submit" disabled={!cliente || descripcion.trim().length < 3} cargando={guardar.isPending}>Crear orden</Boton>
          <Boton type="button" variante="secundario" onClick={() => navegar('/ordenes')}>Cancelar</Boton>
        </div>
      </form>
    </>
  );
}
