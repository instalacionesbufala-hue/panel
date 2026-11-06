// «Resumen de nómina contable y de costes» de la gestoría (BACKEND.md, encargo 12). Sin DOM ni red:
// recibe las filas de la hoja «Detalle» (como las da SheetJS con header: 1) y los técnicos del mes.
//
// Estructura: columna A = concepto, B = «Total» de la empresa, desde C una columna por contrato.
// El nombre de cada columna va en tres filas (en mayúsculas y truncado a 10 caracteres); la fila del medio
// es la que lleva «Total» en la columna B. La fila «TOTAL» (exacta: no «TOTAL DEVENGOS» ni «TOTAL LIQUIDO»)
// da el coste de empresa = devengos + Seguridad Social de empresa.

export const normalizar = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const texto = v => (typeof v === 'string' ? v.trim() : '');
const numero = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null);
const centimos = n => Math.round(n * 100) / 100;

/** → { empleados: [{ nombre, trozos, importe, columnas }], total, sumaColumnas, cuadra } o lanza Error con el motivo */
export function leerResumenGestoria(filas) {
  const iTotal = filas.findIndex(f => texto(f?.[0]).toUpperCase() === 'TOTAL');
  if (iTotal < 0) throw new Error('No encuentro la fila «TOTAL» en la hoja «Detalle». ¿Es el «Resumen de nómina contable y de costes» de la gestoría?');
  const iNombre = filas.findIndex((f, i) => i < iTotal && texto(f?.[1]).toLowerCase() === 'total');
  if (iNombre < 1) throw new Error('No encuentro la cabecera con los nombres de los empleados (la fila con «Total» en la columna B).');
  const filaTotal = filas[iTotal];
  const total = numero(filaTotal[1]);
  if (total === null) throw new Error('La fila «TOTAL» no trae el total de la empresa en la columna B.');

  const porNombre = new Map();
  let sumaColumnas = 0;
  for (let c = 2; c < filaTotal.length; c++) {
    const importe = numero(filaTotal[c]);
    const trozos = [filas[iNombre - 1]?.[c], filas[iNombre][c], filas[iNombre + 1]?.[c]].map(texto).filter(Boolean);
    if (importe === null && !trozos.length) continue;
    if (importe === null) throw new Error(`La columna de ${trozos.join(' ')} no tiene importe en la fila «TOTAL».`);
    sumaColumnas += importe;
    // Un empleado puede tener dos columnas en el mes (cambio de contrato): se suman
    const clave = normalizar(trozos.join(' '));
    const e = porNombre.get(clave) || { nombre: trozos.join(' '), trozos, importe: 0, columnas: 0 };
    e.importe = centimos(e.importe + importe);
    e.columnas++;
    porNombre.set(clave, e);
  }
  sumaColumnas = centimos(sumaColumnas);
  return { empleados: [...porNombre.values()], total: centimos(total), sumaColumnas, cuadra: Math.abs(sumaColumnas - total) <= 0.02, periodo: periodo(filas, iNombre) };
}

// «Proceso: Septiembre del 2026» → '2026-09' (null si no se encuentra)
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function periodo(filas, hasta) {
  for (const f of filas.slice(0, hasta)) {
    if (normalizar(f?.[0]) !== 'proceso') continue;
    const m = /([a-z]+)\s+(?:de[l]?\s+)?(\d{4})/.exec(normalizar(f.slice(1).filter(Boolean).join(' ')));
    const i = m ? MESES.indexOf(m[1] === 'setiembre' ? 'septiembre' : m[1]) : -1;
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}`;
  }
  return null;
}

// Lo casa el apellido (última palabra del nombre del panel) presente entre las palabras de la gestoría y, además,
// un nombre compatible por prefijo en cualquier sentido (la gestoría trunca: «ALBE» ↔ «Alberto»; el panel
// abrevia: «J. Alberto» ↔ «JAIRO»). Si casan dos o ninguno, no se adivina.
function casa(tecnico, empleado) {
  const p = normalizar(tecnico.nombre).split(' ').filter(Boolean);
  if (p.length < 2) return false;
  const apellido = p[p.length - 1], nombres = p.slice(0, -1);
  const palabras = normalizar(empleado.trozos.join(' ')).split(' ').filter(Boolean);
  if (!palabras.includes(apellido)) return false;
  const deNombre = normalizar(empleado.trozos[0] || '').split(' ').filter(Boolean);
  return nombres.some(n => deNombre.some(g => n.startsWith(g) || g.startsWith(n)));
}

/** → { casados: [{ tecnico, empleado }], sinCasar: [{ empleado, candidatos }] } */
export function emparejar(empleados, tecnicos) {
  const candidatos = empleados.map(e => tecnicos.filter(t => casa(t, e)));
  // Un técnico reclamado por dos empleados distintos tampoco se adivina
  const veces = new Map();
  candidatos.forEach(c => { if (c.length === 1) veces.set(c[0].id, (veces.get(c[0].id) || 0) + 1); });
  const casados = [], sinCasar = [];
  empleados.forEach((e, i) => {
    const c = candidatos[i];
    if (c.length === 1 && veces.get(c[0].id) === 1) casados.push({ tecnico: c[0], empleado: e });
    else sinCasar.push({ empleado: e, candidatos: c });
  });
  return { casados, sinCasar };
}
