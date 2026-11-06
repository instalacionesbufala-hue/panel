// Markdown → HTML para los informes de la Dirección (vienen de ficheros de Drive).
// Se escapa todo el texto antes de aplicar las marcas: el HTML del informe se ve como texto, nunca se ejecuta.
// Cubre lo que generan los informes: títulos, párrafos, **negrita**, *cursiva*, `código`, listas, tablas, citas, --- y enlaces http(s).
import { esc } from './ui.js?v=41';

function enLinea(texto) {
  const codigos = [];
  let t = esc(texto).replace(/`([^`]+)`/g, (_, c) => `\u0000${codigos.push(c) - 1}\u0000`);
  t = t
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__([^_]+?)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codigos[i]}</code>`);
}

const celdas = linea => linea.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const esSeparadorTabla = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

function tabla(lineas) {
  const cabecera = celdas(lineas[0]);
  const alineacion = celdas(lineas[1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
  const estilo = i => alineacion[i] ? ` style="text-align:${alineacion[i]}"` : '';
  const filas = lineas.slice(2).map(l => `<tr>${celdas(l).map((c, i) => `<td${estilo(i)}>${enLinea(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="tabla-desplazable"><table><thead><tr>${cabecera.map((c, i) => `<th${estilo(i)}>${enLinea(c)}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></div>`;
}

export function markdownAHtml(md) {
  const lineas = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) {
      const bloque = [];
      for (i++; i < lineas.length && !/^```/.test(lineas[i]); i++) bloque.push(lineas[i]);
      i++;
      html.push(`<pre><code>${esc(bloque.join('\n'))}</code></pre>`);
      continue;
    }
    const titulo = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (titulo) { const n = Math.min(titulo[1].length + 1, 6); html.push(`<h${n}>${enLinea(titulo[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { html.push('<hr>'); i++; continue; }
    if (l.includes('|') && i + 1 < lineas.length && esSeparadorTabla(lineas[i + 1])) {
      const bloque = [l, lineas[i + 1]];
      for (i += 2; i < lineas.length && lineas[i].includes('|') && lineas[i].trim(); i++) bloque.push(lineas[i]);
      html.push(tabla(bloque));
      continue;
    }
    if (/^\s*>/.test(l)) {
      const bloque = [];
      for (; i < lineas.length && /^\s*>/.test(lineas[i]); i++) bloque.push(lineas[i].replace(/^\s*>\s?/, ''));
      html.push(`<blockquote>${markdownAHtml(bloque.join('\n'))}</blockquote>`);
      continue;
    }
    const lista = /^\s*([-*+]|\d+[.)])\s+/.exec(l);
    if (lista) {
      const ordenada = /\d/.test(lista[1]);
      const items = [];
      for (; i < lineas.length; i++) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lineas[i]);
        if (m) items.push(m[2]);
        else if (lineas[i].trim() && /^\s{2,}/.test(lineas[i]) && items.length) items[items.length - 1] += ' ' + lineas[i].trim();
        else break;
      }
      const etiqueta = ordenada ? 'ol' : 'ul';
      html.push(`<${etiqueta}>${items.map(x => `<li>${enLinea(x)}</li>`).join('')}</${etiqueta}>`);
      continue;
    }
    const parrafo = [];
    for (; i < lineas.length && lineas[i].trim() && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lineas[i])
      && !(lineas[i].includes('|') && i + 1 < lineas.length && esSeparadorTabla(lineas[i + 1])); i++) parrafo.push(lineas[i].trim());
    html.push(`<p>${parrafo.map(enLinea).join('<br>')}</p>`);
  }
  return html.join('\n');
}
