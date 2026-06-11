// One-off helper: vendors the site's Google Fonts into ./fonts so the page
// has no dependency on fonts.googleapis.com (blocked in some regions).
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'fonts');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();
  const blocks = css.split('/* ').filter((b) => b.startsWith('latin')); // latin + latin-ext only
  let outCss = '';
  let n = 0;
  for (const b of blocks) {
    const face = '/* ' + b;
    const m = face.match(/url\((https:[^)]+\.woff2)\)/);
    if (!m) continue;
    const fam = (face.match(/font-family: '([^']+)'/) || [])[1].replace(/ /g, '');
    const style = (face.match(/font-style: (\w+)/) || [])[1];
    const weight = (face.match(/font-weight: (\d+)/) || [])[1];
    const subset = b.startsWith('latin-ext') ? 'latinext' : 'latin';
    const fname = `${fam}-${weight}${style === 'italic' ? 'i' : ''}-${subset}.woff2`;
    const buf = Buffer.from(await (await fetch(m[1], { headers: { 'User-Agent': UA } })).arrayBuffer());
    fs.writeFileSync(path.join(OUT, fname), buf);
    outCss += face.replace(m[1], fname).trim() + '\n';
    n += 1;
  }
  fs.writeFileSync(path.join(OUT, 'fonts.css'), outCss);
  const total = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`${n} font files, ${(total / 1024).toFixed(0)} KB total`);
})();
