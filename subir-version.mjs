// Sube el número de versión (?v=N) en index.html y en TODOS los import de js/.
// Todos deben llevar el mismo número: si un módulo se importara con dos URL distintas,
// el navegador lo cargaría dos veces y la sesión quedaría partida.
// Uso:  node subir-version.mjs        (siguiente número)
//       node subir-version.mjs 12     (número concreto)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const index = path.join(raiz, 'index.html');
let html = fs.readFileSync(index, 'utf8');
const actual = Number((html.match(/app\.js\?v=(\d+)/) || [])[1] || 0);
const nueva = Number(process.argv[2] || actual + 1);
if (!Number.isInteger(nueva) || nueva <= 0) throw new Error('Versión no válida: ' + process.argv[2]);

html = html.replace(/(css\/panel\.css|js\/app\.js)(\?v=\d+)?"/g, `$1?v=${nueva}"`);
fs.writeFileSync(index, html);

const dirJs = path.join(raiz, 'js');
for (const f of fs.readdirSync(dirJs).filter(f => f.endsWith('.js'))) {
  const ruta = path.join(dirJs, f);
  const s = fs.readFileSync(ruta, 'utf8');
  const t = s.replace(/(from '\.\/[\w-]+\.js)(\?v=\d+)?'/g, `$1?v=${nueva}'`);
  if (t !== s) fs.writeFileSync(ruta, t);
}
console.log(`Versión ${actual} → ${nueva}`);
