// Μετατροπή του cons3d_manual.tex σε HTML για άνοιγμα στο Word: οι εξισώσεις γίνονται MathML
// (KaTeX), που το Word μετατρέπει σε κανονικές εξισώσεις. Καλύπτει το υποσύνολο LaTeX του
// εγχειριδίου. Αριθμοί ενοτήτων, εξισώσεων και πινάκων από το .aux της μεταγλώττισης LaTeX.
// Χρήση: node tex2html.mjs <tex> <aux> <out.html>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import katex from 'katex';

const [texPath, auxPath, outPath] = process.argv.slice(2);
const tex = fs.readFileSync(texPath, 'utf8').replace(/\r\n/g, '\n');
const aux = fs.readFileSync(auxPath, 'utf8');

// Ετικέτες → αριθμοί (\newlabel{key}{{num}{page}...})
const labels = {};
for (const m of aux.matchAll(/\\newlabel\{([^}]+)\}\{\{([^}]*)\}/g)) labels[m[1]] = m[2];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Ταίριασμα αγκίστρων: επιστρέφει [περιεχόμενο, θέση μετά το '}']
const readGroup = (s, i) => {
  if (s[i] !== '{') throw new Error(`αναμενόταν { στη θέση ${i}: ${s.slice(i, i + 40)}`);
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  throw new Error('μη κλειστό άγκιστρο');
};

// Αντικατάσταση εντολής με ένα όρισμα, με σωστό ταίριασμα αγκίστρων
const replaceCmd = (s, name, fn, nargs = 1) => {
  const re = new RegExp(`\\\\${name}(?![a-zA-Z])`, 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    let pos = m.index + m[0].length;
    const args = [];
    for (let k = 0; k < nargs; k++) { while (s[pos] === ' ') pos++; const [a, end] = readGroup(s, pos); args.push(a); pos = end; }
    out += s.slice(last, m.index) + fn(...args);
    last = pos; re.lastIndex = pos;
  }
  return out + s.slice(last);
};

const mathml = (src, display) => {
  const html = katex.renderToString(src, { displayMode: display, output: 'mathml', throwOnError: true, strict: 'ignore' });
  return html.match(/<math[\s\S]*<\/math>/)[0].replace(/<annotation[\s\S]*?<\/annotation>/g, '');
};

// Κείμενο μέσα σε παράγραφο: μαθηματικά, έντονα, αναφορές, ειδικοί χαρακτήρες
const inline = (s) => {
  const maths = [];
  s = s.replace(/\\texorpdfstring\{((?:[^{}]|\{[^{}]*\})*)\}\{[^{}]*\}/g, '$1');
  s = replaceCmd(s, 'mbox', (a) => a);
  // Εκθέτης χωρίς βάση (π.χ. kN/m$^3$): απλός εκθέτης κειμένου, γιατί στο Word θα έβγαινε κενό πλαίσιο βάσης
  s = s.replace(/\$\^\{?([^${}]+)\}?\$/g, '\\textsuperscript{$1}');
  s = s.replace(/\$([^$]+)\$/g, (_, m) => { maths.push(mathml(m, false)); return `\u0000M${maths.length - 1}\u0000`; });
  s = s.replace(/\\label\{[^}]*\}/g, '');
  s = s.replace(/\\ref\{([^}]+)\}/g, (_, k) => { if (!(k in labels)) throw new Error(`άγνωστη ετικέτα ${k}`); return labels[k]; });
  s = esc(s.replace(/\\&/g, '\u0001').replace(/\\%/g, '%').replace(/\\_/g, '_').replace(/\\,/g, ' ').replace(/~/g, ' ')
    .replace(/``/g, '“').replace(/''/g, '”').replace(/--/g, '–').replace(/\\\\/g, '\u0002'))
    .replace(/\u0001/g, '&amp;').replace(/\u0002\s*/g, '<br>');
  s = s.replace(/\\cons\{\}|\\cons\b/g, '<b>CONS_3D</b>');
  s = replaceCmd(s, 'textbf', (a) => `<b>${a}</b>`);
  s = replaceCmd(s, 'textsuperscript', (a) => `<sup>${a}</sup>`);
  s = replaceCmd(s, 'href', (url, text) => `<a href="${url}">${text}</a>`, 2);
  if (/\\[a-zA-Z]/.test(s)) throw new Error(`εντολή που δεν μετατράπηκε: ${s.match(/\\[a-zA-Z]+/)[0]} σε «${s.slice(0, 80)}»`);
  // Το Word πετά το κανονικό κενό αμέσως μετά από <math>· μπαίνει μη διασπώμενο κενό, που το
  // build_docx.ps1 ξανακάνει κανονικό μετά την εισαγωγή
  return s.replace(/\u0000M(\d+)\u0000/g, (_, i) => maths[i]).replace(/\s+/g, ' ').trim()
    .replace(/<\/math> /g, '</math>&#160;');
};

// Εικόνα με πλάτος και ύψος σε px: το Word, αν δοθεί μόνο το πλάτος, παίρνει το ύψος από την
// ανάλυση (dpi) του αρχείου και παραμορφώνει την εικόνα. Διαστάσεις από την κεφαλίδα PNG/JPEG.
const imgDirs = [path.dirname(outPath), path.dirname(texPath), path.dirname(fileURLToPath(import.meta.url))];
const img = (name, width) => {
  const dir = imgDirs.find(d => fs.existsSync(path.join(d, name)));
  if (!dir) throw new Error(`δεν βρέθηκε η εικόνα ${name}`);
  const b = fs.readFileSync(path.join(dir, name));
  let w, h;
  if (b.readUInt32BE(0) === 0x89504e47) { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
  else {
    for (let i = 2; i < b.length;) {
      const mk = b[i + 1], len = b.readUInt16BE(i + 2);
      if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
      i += 2 + len;
    }
  }
  if (!w || !h) throw new Error(`άγνωστες διαστάσεις εικόνας ${name}`);
  return `<img src="${name}" width="${width}" height="${Math.round(width * h / w)}">`;
};

// Περιεχόμενο μπλοκ: εντολές ενοτήτων, περιβάλλοντα και παράγραφοι
const counters = { sec: 0, sub: 0, subsub: 0, eq: 0 };
const block = (s) => {
  const out = [];
  let i = 0;
  const para = [];
  // Αλλαγή γραμμής (\\) μέσα σε παράγραφο, π.χ. «\textbf{Βήμα 1ο: …}\\»: η πρώτη γραμμή γίνεται
  // χωριστή παράγραφος δεμένη με την επόμενη, γιατί με πλήρη στοίχιση το Word την απλώνει σε όλο το πλάτος
  const flush = () => {
    const t = para.join('\n').trim(); para.length = 0;
    if (t) t.split(/\n\s*\n/).forEach(p => {
      const h = inline(p); if (!h) return;
      const lines = h.split(/\s*<br>\s*/);
      lines.forEach((x, k) => out.push(k < lines.length - 1 ? `<p class="lead">${x}</p>` : `<p>${x}</p>`));
    });
  };
  while (i < s.length) {
    const rest = s.slice(i);
    let m;
    if ((m = rest.match(/^\\(section|subsection|subsubsection)\{/))) {
      flush();
      const [title, end] = readGroup(s, i + m[0].length - 1);
      let num;
      if (m[1] === 'section') { counters.sec++; counters.sub = 0; counters.subsub = 0; num = `${counters.sec}`; }
      else if (m[1] === 'subsection') { counters.sub++; counters.subsub = 0; num = `${counters.sec}.${counters.sub}`; }
      else { counters.subsub++; num = `${counters.sec}.${counters.sub}.${counters.subsub}`; }
      const tag = { section: 'h1', subsection: 'h2', subsubsection: 'h3' }[m[1]];
      out.push(`<${tag}>${num}&nbsp;&nbsp;${inline(title)}</${tag}>`);
      i = end; continue;
    }
    if ((m = rest.match(/^\\begin\{([a-z*]+)\}(\[[^\]]*\])?/))) {
      flush();
      const env = m[1];
      // Εύρεση του αντίστοιχου \end με μέτρηση εμφώλευσης
      const reEnv = new RegExp(`\\\\(begin|end)\\{${env.replace('*', '\\*')}\\}`, 'g');
      reEnv.lastIndex = i + m[0].length; let depth = 1, mm, bodyEnd = -1, after = -1;
      while ((mm = reEnv.exec(s))) { depth += mm[1] === 'begin' ? 1 : -1; if (depth === 0) { bodyEnd = mm.index; after = mm.index + mm[0].length; break; } }
      const body = s.slice(i + m[0].length, bodyEnd);
      out.push(environment(env, body));
      i = after; continue;
    }
    if ((m = rest.match(/^\\(maketitle|centering|noindent)\b/))) { flush(); i += m[0].length; continue; }
    const nl = s.indexOf('\n', i);
    const line = s.slice(i, nl === -1 ? s.length : nl);
    if (/^\s*%/.test(line)) { i = nl === -1 ? s.length : nl + 1; continue; }
    // Γραμμή κειμένου έως την επόμενη εντολή μπλοκ στην ίδια γραμμή
    const cut = line.search(/\\(begin|section|subsection|subsubsection)\{/);
    if (cut > 0) { para.push(line.slice(0, cut)); i += cut; continue; }
    para.push(line);
    i = nl === -1 ? s.length : nl + 1;
  }
  flush();
  return out.join('\n');
};

const splitItems = (body) => {
  const items = []; let depth = 0, start = -1;
  const re = /\\(begin|end)\{(itemize|enumerate)\}|\\item\b/g; let m;
  while ((m = re.exec(body))) {
    if (m[1] === 'begin') depth++;
    else if (m[1] === 'end') depth--;
    else if (depth === 0) { if (start >= 0) items.push(body.slice(start, m.index)); start = m.index + m[0].length; }
  }
  if (start >= 0) items.push(body.slice(start));
  return items;
};

const environment = (env, body) => {
  if (env === 'equation') {
    counters.eq++;
    const src = body.replace(/\\label\{[^}]*\}/g, '').trim();
    return `<table class="eq" width="100%"><tr><td width="8%"></td><td width="84%" align="center">${mathml(src, true)}</td><td width="8%" align="right">(${counters.eq})</td></tr></table>`;
  }
  if (env === 'itemize' || env === 'enumerate') {
    const tag = env === 'itemize' ? 'ul' : 'ol';
    return `<${tag}>` + splitItems(body).map(it => `<li>${block(it.trim()).replace(/^<p>([\s\S]*?)<\/p>/, '$1')}</li>`).join('') + `</${tag}>`;
  }
  if (env === 'quote') return `<blockquote>${block(body)}</blockquote>`;
  if (env === 'center' && /tikzpicture/.test(body)) return `<p class="fig">${img('stencil.png', 380)}</p>`;
  if (env === 'table') {
    const [caption] = readGroup(body, body.indexOf('\\caption{') + 8);
    const label = body.match(/\\label\{([^}]+)\}/)[1];
    const tab = body.match(/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/);
    const aligns = tab[1].split('').map(c => ({ l: 'left', c: 'center', r: 'right' }[c]));
    const rows = tab[2].replace(/\\(toprule|bottomrule)/g, '').split(/\\midrule/);
    const toRows = (part, cell) => part.split(/\\\\/).map(r => r.trim()).filter(Boolean)
      .map(r => `<tr>${r.split(/(?<!\\)&/).map((c, k) => `<${cell} align="${aligns[k]}">${inline(c.trim())}</${cell}>`).join('')}</tr>`).join('');
    return `<p class="caption"><b>Πίνακας ${labels[label]}.</b> ${inline(caption)}</p>`
      + `<table class="data" align="center"><thead>${toRows(rows[0], 'th')}</thead><tbody>${toRows(rows[1], 'td')}</tbody></table>`;
  }
  throw new Error(`άγνωστο περιβάλλον ${env}`);
};

// Σώμα: από το \end{titlepage} ως το \end{document}
const bodyStart = tex.indexOf('\\end{titlepage}');
const body = tex.slice(tex.indexOf('\n', bodyStart) + 1, tex.indexOf('\\end{document}'))
  .replace(/\\hypersetup\{[^}]*\}/g, '');
const title = inline(readGroup(tex, tex.indexOf('\\title{') + 6)[0]);
const author = inline(readGroup(tex, tex.indexOf('\\author{') + 7)[0]);
const date = inline(readGroup(tex, tex.indexOf('\\date{') + 5)[0]);

const css = `
body { font-family: 'Times New Roman'; font-size: 11pt; text-align: justify; }
p { margin: 0 0 6pt 0; }
p.lead { margin: 6pt 0 0 0; text-align: left; page-break-after: avoid; }
h1 { font-family: 'Times New Roman'; font-size: 16pt; margin: 18pt 0 6pt 0; }
h2 { font-family: 'Times New Roman'; font-size: 14pt; margin: 14pt 0 6pt 0; }
h3 { font-family: 'Times New Roman'; font-size: 12pt; margin: 12pt 0 5pt 0; }
table.eq { border: none; border-collapse: collapse; margin: 4pt 0; }
table.eq td { border: none; vertical-align: middle; font-family: 'Times New Roman'; font-size: 11pt; }
table.data { border-collapse: collapse; border-top: 1.5pt solid black; border-bottom: 1.5pt solid black; margin: 0 auto 10pt auto; }
table.data th { border-bottom: 0.75pt solid black; padding: 3pt 8pt; font-size: 10pt; }
table.data td { padding: 2pt 8pt; font-size: 10pt; }
p.caption { text-align: center; font-size: 10pt; margin: 10pt 0 4pt 0; }
p.fig { text-align: center; }
blockquote { margin: 6pt 36pt; }
p.title { text-align: center; font-size: 16pt; font-weight: bold; margin: 0 0 10pt 0; }
p.author, p.date { text-align: center; font-size: 12pt; margin: 0 0 4pt 0; }
p.cover-head { font-size: 12pt; font-weight: bold; margin: 0; text-align: left; }
p.cover-title { text-align: center; font-size: 18pt; font-weight: bold; margin: 60pt 0 14pt 0; }
p.cover-sub { text-align: center; font-size: 16pt; font-weight: bold; margin: 0 0 10pt 0; }
p.cover-url, p.cover-fig, p.cover-author, p.cover-date { text-align: center; font-size: 12pt; margin: 0; }
p.cover-fig { margin-top: 20pt; } p.cover-author { margin-top: 36pt; } p.cover-date { margin-top: 44pt; }
`;

const cover = `
<table class="cover-head" width="100%" style="border:none"><tr>
  <td width="52%" style="border:none">${img('upatras_logo.jpg', 270)}</td>
  <td width="48%" style="border:none; vertical-align: middle"><p class="cover-head">ΠΑΝΕΠΙΣΤΗΜΙΟ ΠΑΤΡΩΝ</p><p class="cover-head">ΤΜΗΜΑ ΠΟΛΙΤΙΚΩΝ ΜΗΧΑΝΙΚΩΝ</p></td>
</tr></table>
<p class="cover-title" id="cover-title">CONS_3D</p>
<p class="cover-sub">Κώδικας τρισδιάστατης ανάλυσης τάσεων, καθιζήσεων και στερεοποίησης:<br>Εγχειρίδιο χρήσης και θεωρία</p>
<p class="cover-url"><a href="https://takispelekis-lgtm.github.io/3D_CONS_SET/">https://takispelekis-lgtm.github.io/3D_CONS_SET/</a></p>
<p class="cover-fig" id="cover-fig">${img('cover_image.png', 470)}</p>
<p class="cover-author" id="cover-author"><b>ΠΑΝΑΓΙΩΤΗΣ ΠΕΛΕΚΗΣ</b><br><b>Αναπληρωτής Καθηγητής</b></p>
<p class="cover-date" id="cover-date">Πάτρα, Νοέμβριος 2026</p>
`;

const html = `<!DOCTYPE html><html lang="el"><head><meta charset="utf-8"><title>CONS_3D: Εγχειρίδιο</title><style>${css}</style></head><body>
${cover}
<p class="title" id="inner-title">${title.replace(/<\/?b>/g, '')}</p>
<p class="author">${author}</p>
<p class="date">${date}</p>
${block(body)}
</body></html>`;
fs.writeFileSync(outPath, html, 'utf8');
console.log(`HTML: ${outPath} · ενότητες ${counters.sec} · εξισώσεις ${counters.eq} · ετικέτες aux ${Object.keys(labels).length}`);
