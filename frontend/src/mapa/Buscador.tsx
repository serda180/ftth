import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { buscarRed } from './api';
import type { ResultadoBusqueda } from './tipos';

export function Buscador({ alElegir }: { alElegir: (r: ResultadoBusqueda) => void }) {
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setConsulta(texto.trim()), 300);
    return () => window.clearTimeout(t);
  }, [texto]);

  const resultados = useQuery({
    queryKey: ['mapa', 'buscar', consulta],
    queryFn: () => buscarRed(consulta),
    enabled: consulta.length >= 2,
    staleTime: 10_000,
  });

  const lista = resultados.data ?? [];

  function elegir(r: ResultadoBusqueda) {
    alElegir(r);
    setAbierto(false);
    setTexto(r.titulo);
  }

  return (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" aria-hidden />
      <input
        type="search"
        role="combobox"
        aria-expanded={abierto && lista.length > 0}
        aria-controls="resultados-busqueda"
        aria-label="Buscar en la red"
        placeholder="Buscar NAP, poste, cable o cliente"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
          setActivo(0);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => window.setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActivo((a) => Math.min(a + 1, lista.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActivo((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && lista[activo]) {
            e.preventDefault();
            elegir(lista[activo]);
          } else if (e.key === 'Escape') {
            setAbierto(false);
          }
        }}
        className="w-full rounded-md border border-linea bg-superficie py-2.5 pl-9 pr-9 text-[15px] shadow-sm outline-none focus:border-acento"
      />
      {texto && (
        <button
          type="button"
          aria-label="Limpiar búsqueda"
          onClick={() => {
            setTexto('');
            setConsulta('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-tenue hover:text-tinta"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
      {abierto && consulta.length >= 2 && (
        <ul
          id="resultados-busqueda"
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 max-h-80 overflow-auto rounded-md border border-linea bg-superficie py-1 shadow-lg"
        >
          {resultados.isFetching && lista.length === 0 && <li className="px-3 py-2 text-tenue">Buscando…</li>}
          {!resultados.isFetching && lista.length === 0 && (
            <li className="px-3 py-2 text-tenue">Sin resultados para "{consulta}".</li>
          )}
          {lista.map((r, i) => (
            <li
              key={`${r.tipo}-${r.id}`}
              role="option"
              aria-selected={i === activo}
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(r);
              }}
              className={`cursor-pointer px-3 py-2 ${i === activo ? 'bg-fondo' : ''}`}
            >
              <p className="font-medium">{r.titulo}</p>
              <p className="truncate text-sm text-tenue">
                {r.detalle}
                {r.lng == null && ' · sin ubicación en el mapa'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
