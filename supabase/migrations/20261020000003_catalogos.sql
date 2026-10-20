-- =====================================================================
-- 0003 · Catálogos y configuración
-- =====================================================================

-- ---------------------------------------------------------------------
-- Regiones y comunas de Chile
-- ---------------------------------------------------------------------
create table public.regiones (
  id smallint primary key,            -- orden geográfico norte → sur
  codigo text not null unique,        -- numeración romana oficial
  nombre text not null unique
);

insert into public.regiones (id, codigo, nombre) values
  (1,  'XV',   'Arica y Parinacota'),
  (2,  'I',    'Tarapacá'),
  (3,  'II',   'Antofagasta'),
  (4,  'III',  'Atacama'),
  (5,  'IV',   'Coquimbo'),
  (6,  'V',    'Valparaíso'),
  (7,  'RM',   'Metropolitana de Santiago'),
  (8,  'VI',   'Libertador General Bernardo O''Higgins'),
  (9,  'VII',  'Maule'),
  (10, 'XVI',  'Ñuble'),
  (11, 'VIII', 'Biobío'),
  (12, 'IX',   'La Araucanía'),
  (13, 'XIV',  'Los Ríos'),
  (14, 'X',    'Los Lagos'),
  (15, 'XI',   'Aysén del General Carlos Ibáñez del Campo'),
  (16, 'XII',  'Magallanes y de la Antártica Chilena');

create table public.comunas (
  id serial primary key,
  region_id smallint not null references public.regiones (id),
  nombre text not null,
  activo boolean not null default true,
  unique (region_id, nombre)
);

-- Se cargan las 33 comunas de la Región del Biobío (zona de operación).
-- Las demás se agregan desde Configuración cuando se necesiten.
insert into public.comunas (region_id, nombre)
select 11, unnest(array[
  -- Provincia de Concepción
  'Concepción', 'Coronel', 'Chiguayante', 'Florida', 'Hualqui', 'Lota',
  'Penco', 'San Pedro de la Paz', 'Santa Juana', 'Talcahuano', 'Tomé', 'Hualpén',
  -- Provincia de Arauco
  'Lebu', 'Arauco', 'Cañete', 'Contulmo', 'Curanilahue', 'Los Álamos', 'Tirúa',
  -- Provincia del Biobío
  'Los Ángeles', 'Antuco', 'Cabrero', 'Laja', 'Mulchén', 'Nacimiento', 'Negrete',
  'Quilaco', 'Quilleco', 'San Rosendo', 'Santa Bárbara', 'Tucapel', 'Yumbel',
  'Alto Biobío'
]);

-- ---------------------------------------------------------------------
-- Tipos de elemento de red
-- La "clase" define en qué tabla de detalle viven sus datos propios;
-- el "tipo" es configurable (ej.: NAP y CTO son ambos de clase nap).
-- ---------------------------------------------------------------------
create type public.clase_elemento as enum (
  'olt', 'nap', 'poste', 'camara', 'caja_empalme', 'splitter',
  'gabinete', 'punto_ingreso', 'otro'
);

create table public.tipos_elemento (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nombre text not null,
  clase public.clase_elemento not null,
  icono text not null default 'circle',
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  orden int not null default 100,
  activo boolean not null default true
);

insert into public.tipos_elemento (codigo, nombre, clase, icono, color, orden) values
  ('olt',              'OLT',                        'olt',           'server',      '#7c3aed', 10),
  ('nap',              'NAP',                        'nap',           'box',         '#0891b2', 20),
  ('cto',              'CTO',                        'nap',           'box',         '#0e7490', 21),
  ('poste',            'Poste',                      'poste',         'utility-pole','#78716c', 30),
  ('camara',           'Cámara',                     'camara',        'square',      '#57534e', 40),
  ('caja_empalme',     'Caja de empalme',            'caja_empalme',  'git-merge',   '#d97706', 50),
  ('splitter',         'Splitter',                   'splitter',      'split',       '#db2777', 60),
  ('gabinete',         'Gabinete',                   'gabinete',      'archive',     '#4f46e5', 70),
  ('punto_ingreso',    'Punto de ingreso a edificio','punto_ingreso', 'building-2',  '#16a34a', 80),
  ('punto_distribucion','Punto de distribución',     'otro',          'circle-dot',  '#475569', 90);

-- ---------------------------------------------------------------------
-- Modelos de cable (valores típicos; la empresa los ajusta)
-- ---------------------------------------------------------------------
create table public.modelos_cable (
  id serial primary key,
  nombre text not null unique,
  cantidad_fibras int not null check (cantidad_fibras between 1 and 864),
  fibras_por_tubo int not null default 12 check (fibras_por_tubo between 1 and 24),
  atenuacion_db_km numeric(5,3) not null default 0.350 check (atenuacion_db_km >= 0),
  descripcion text,
  activo boolean not null default true
);

insert into public.modelos_cable (nombre, cantidad_fibras, fibras_por_tubo, descripcion) values
  ('ADSS 12F',  12, 12, 'Autosoportado, 12 fibras'),
  ('ADSS 24F',  24, 12, 'Autosoportado, 24 fibras'),
  ('ADSS 48F',  48, 12, 'Autosoportado, 48 fibras'),
  ('ADSS 96F',  96, 12, 'Autosoportado, 96 fibras'),
  ('Drop 1F',    1,  1, 'Cable de acometida, 1 fibra');

-- ---------------------------------------------------------------------
-- Ratios de splitter (pérdida de inserción típica máxima; editable)
-- ---------------------------------------------------------------------
create table public.ratios_splitter (
  id serial primary key,
  ratio text not null unique check (ratio ~ '^1:[0-9]+$'),
  salidas int not null unique check (salidas between 2 and 128),
  perdida_db numeric(4,2) not null check (perdida_db >= 0),
  activo boolean not null default true,
  check (ratio = '1:' || salidas)
);

insert into public.ratios_splitter (ratio, salidas, perdida_db) values
  ('1:2',  2,  4.00),
  ('1:4',  4,  7.30),
  ('1:8',  8, 10.50),
  ('1:16', 16, 13.70),
  ('1:32', 32, 17.10);

-- ---------------------------------------------------------------------
-- Planes comerciales (sin datos: los define la empresa)
-- ---------------------------------------------------------------------
create table public.planes (
  id serial primary key,
  nombre text not null unique,
  bajada_mbps int not null check (bajada_mbps > 0),
  subida_mbps int not null check (subida_mbps > 0),
  precio_clp int not null check (precio_clp >= 0),
  descripcion text,
  activo boolean not null default true,
  es_demo boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create trigger planes_actualizado_en
  before update on public.planes
  for each row execute function public.tg_actualizado_en();

-- ---------------------------------------------------------------------
-- Parámetros configurables de la empresa
-- ---------------------------------------------------------------------
create table public.configuracion (
  clave text primary key check (clave ~ '^[a-z0-9_]+$'),
  valor jsonb not null,
  descripcion text not null,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.perfiles (id) on delete set null
);
create trigger configuracion_actualizado_en
  before update on public.configuracion
  for each row execute function public.tg_actualizado_en();

insert into public.configuracion (clave, valor, descripcion) values
  ('nombre_empresa',            '""'::jsonb,   'Nombre del ISP que aparece en la plataforma'),
  ('distancia_max_acometida_m', '250'::jsonb,  'Distancia máxima de acometida aceptada, en metros'),
  ('presupuesto_optico_db',     '28'::jsonb,   'Presupuesto óptico de referencia (ej.: GPON clase B+ = 28 dB)'),
  ('perdida_conector_db',       '0.5'::jsonb,  'Pérdida estimada por conector, en dB'),
  ('perdida_empalme_db',        '0.1'::jsonb,  'Pérdida estimada por empalme por fusión, en dB'),
  ('potencia_min_dbm',          '-27'::jsonb,  'Potencia óptica mínima aceptable en la ONT, en dBm'),
  ('potencia_max_dbm',          '-8'::jsonb,   'Potencia óptica máxima aceptable en la ONT, en dBm'),
  ('reserva_puerto_horas',      '72'::jsonb,   'Horas que dura una reserva de puerto antes de liberarse'),
  ('ocupacion_alerta_pct',      '80'::jsonb,   'Porcentaje de ocupación de una NAP que genera alerta'),
  ('mapa_centro',               '{"lat": -36.8270, "lng": -73.0503, "zoom": 13}'::jsonb,
                                 'Centro y zoom inicial del mapa');
