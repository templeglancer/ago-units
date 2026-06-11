#!/usr/bin/env node
// AGO Unit Compendium builder.
// Parses ../data/text/export_units.txt (names/descriptions, UTF-16LE) and
// ../data/export_descr_unit.txt (stats) and writes a self-contained index.html.
// Re-run after any mod update:  node build.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MOD_ROOT = path.join(__dirname, '..');
const UNITS_TXT = path.join(MOD_ROOT, 'data', 'text', 'export_units.txt');
const EDU_TXT = path.join(MOD_ROOT, 'data', 'export_descr_unit.txt');
const CARD_DIR = path.join(MOD_ROOT, 'data', 'ui', 'units', 'mercs');
const PORTRAIT_DIR = path.join(MOD_ROOT, 'data', 'ui', 'unit_info', 'merc');
const OUT_HTML = path.join(__dirname, 'index.html');
const OUT_PORTRAITS = path.join(__dirname, 'portraits');

// ------------------------------------------------------------- TGA -> PNG

function decodeTga(buf) {
  const idLen = buf[0];
  const type = buf[2];
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const bpp = buf[16];
  const topDown = (buf[17] & 0x20) !== 0;
  if ((type !== 2 && type !== 10) || (bpp !== 24 && bpp !== 32)) return null;
  const bytes = bpp / 8;
  const out = Buffer.alloc(w * h * 4);
  let off = 18 + idLen;
  let p = 0;
  const putPixel = () => {
    out[p * 4] = buf[off + 2];     // R (TGA stores BGR[A])
    out[p * 4 + 1] = buf[off + 1]; // G
    out[p * 4 + 2] = buf[off];     // B
    out[p * 4 + 3] = bytes === 4 ? buf[off + 3] : 255;
    p += 1;
  };
  const total = w * h;
  if (type === 2) {
    while (p < total) { putPixel(); off += bytes; }
  } else {
    while (p < total) {
      const head = buf[off];
      off += 1;
      const count = (head & 0x7f) + 1;
      if (head & 0x80) {
        for (let i = 0; i < count; i++) putPixel();
        off += bytes;
      } else {
        for (let i = 0; i < count; i++) { putPixel(); off += bytes; }
      }
    }
  }
  if (!topDown) {
    const flipped = Buffer.alloc(out.length);
    for (let y = 0; y < h; y++) out.copy(flipped, y * w * 4, (h - 1 - y) * w * 4, (h - y) * w * 4);
    return { w, h, rgba: flipped };
  }
  return { w, h, rgba: out };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(typeStr, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(typeStr, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng({ w, h, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildCardIndex() {
  const index = {};
  if (!fs.existsSync(CARD_DIR)) return index;
  for (const f of fs.readdirSync(CARD_DIR)) {
    const m = f.match(/^#(.+)\.tga$/i);
    if (m) index[m[1].toLowerCase()] = path.join(CARD_DIR, f);
  }
  return index;
}

function cardDataUri(file) {
  try {
    const tga = decodeTga(fs.readFileSync(file));
    if (!tga) return '';
    return 'data:image/png;base64,' + encodePng(tga).toString('base64');
  } catch {
    return '';
  }
}

function buildPortraitIndex() {
  const index = {};
  if (!fs.existsSync(PORTRAIT_DIR)) return index;
  for (const f of fs.readdirSync(PORTRAIT_DIR)) {
    const m = f.match(/^(.+)_info\.tga$/i);
    if (m) index[m[1].toLowerCase()] = path.join(PORTRAIT_DIR, f);
  }
  return index;
}

// Converts <dict>_info.tga to portraits/<dict>.png (skipped when up to date).
// Returns the relative href, or '' on failure.
function exportPortrait(tgaFile, dict) {
  const safe = dict.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const outFile = path.join(OUT_PORTRAITS, safe + '.png');
  const href = 'portraits/' + safe + '.png';
  try {
    if (fs.existsSync(outFile) && fs.statSync(outFile).mtimeMs >= fs.statSync(tgaFile).mtimeMs) {
      return href;
    }
    const tga = decodeTga(fs.readFileSync(tgaFile));
    if (!tga) return '';
    fs.mkdirSync(OUT_PORTRAITS, { recursive: true });
    fs.writeFileSync(outFile, encodePng(tga));
    return href;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- names file

function parseExportUnits(file) {
  let text = fs.readFileSync(file, 'utf16le');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const entries = {};
  let tag = null;
  let buf = [];
  const flush = () => {
    if (tag !== null) entries[tag.toLowerCase()] = buf.join('\n').trim();
    tag = null;
    buf = [];
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '');
    if (line.startsWith('¬')) { flush(); continue; } // ¬ separators / faction banners
    const m = line.match(/^\{([^}]+)\}(.*)$/);
    if (m) {
      flush();
      tag = m[1].trim();
      if (m[2].trim()) buf.push(m[2].trim());
    } else if (tag !== null && line.trim()) {
      buf.push(line.trim());
    }
  }
  flush();
  return entries;
}

// ------------------------------------------------------------------ EDU file

const SECTION_NAMES = {
  'rebel bg': 'Rebel Bodyguards',
  'gondor': 'Gondor',
  'dol amroth': 'Dol Amroth',
  'rohan': 'Rohan',
  'breeland and the shire': 'Bree-land & the Shire',
  'dale': 'Dale',
  'anduin': 'Vale of Anduin',
  'khazad dum': 'Khazad-dûm',
  'erebor': 'Erebor',
  'ered-luin': 'Ered Luin',
  'high elves': 'High Elves',
  'thranduil': 'Woodland Realm',
  'lorien': 'Lórien',
  'dorwinion': 'Dorwinion',
  'enedwaith': 'Enedwaith',
  'dunland': 'Dunland',
  'mordor': 'Mordor',
  'dol guldur': 'Dol Guldur',
  'isengard': 'Isengard',
  'gundabad': 'Gundabad',
  'moria': 'Moria',
  'angmar': 'Angmar',
  'umbar': 'Umbar',
  'harad': 'Harad',
  'easterlings': 'Easterlings (Rhûn)',
  'khand': 'Khand',
  'creatures': 'Creatures',
  'rebels': 'Rebels',
  'mercenaries': 'Mercenaries',
  'siege units': 'Siege Units',
  'ships': 'Ships',
  'miscellaneous': 'Miscellaneous',
};

function sectionDisplayName(raw) {
  let key = raw
    .trim()
    .toLowerCase()
    .replace(/d[^a-z]*nedain/i, 'dunedain'); // mojibake-proof Dúnedain
  if (key === 'northern dunedain') return 'Northern Dúnedain';
  if (SECTION_NAMES[key]) return SECTION_NAMES[key];
  return raw
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function splitCsv(value) {
  return value.split(',').map((s) => s.trim());
}

function parseWeapon(value) {
  // attack, charge, missile, range, ammo, weapon_type, tech, damage, sound, [fx,] delay, skel
  const p = splitCsv(value);
  return {
    attack: Number(p[0]),
    charge: Number(p[1]),
    missile: p[2],
    range: Number(p[3]),
    ammo: Number(p[4]),
    type: p[5],
  };
}

function parseEdu(file) {
  const text = fs.readFileSync(file, 'latin1');
  const units = [];
  let section = 'Miscellaneous';
  let u = null;
  const push = () => {
    if (u) units.push(u);
    u = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const header = line.match(/^;#{10,}\s*([^#]+?)\s*#+\s*$/);
    if (header && /[a-zA-Z]/.test(header[1])) {
      section = sectionDisplayName(header[1]);
      continue;
    }
    if (line.startsWith(';') || !line.trim()) continue;
    const kv = line.match(/^([a-z_][a-z_ 0-9]*?)\s{2,}(.*)$/i) || line.match(/^(\S+)\s+(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const value = kv[2].trim();
    if (key === 'type') {
      push();
      u = { type: value, section, attributes: [], officers: 0 };
      continue;
    }
    if (!u) continue;
    switch (key) {
      case 'dictionary': u.dict = value; break;
      case 'category': u.category = value; break;
      case 'class': u.class = value; break;
      case 'soldier': {
        const p = splitCsv(value);
        u.men = Number(p[1]);
        u.extras = Number(p[2]);
        break;
      }
      case 'officer': u.officers += 1; break;
      case 'mount': u.mount = value; break;
      case 'engine': u.engine = value; break;
      case 'ship': u.ship = value; break;
      case 'attributes': u.attributes = splitCsv(value); break;
      case 'formation': u.formations = splitCsv(value).slice(5).filter((f) => f && f !== 'square'); break;
      case 'mount_effect': u.mountEffect = value; break;
      case 'stat_health': {
        const p = splitCsv(value);
        u.hp = Number(p[0]);
        u.hpMount = Number(p[1] || 0);
        break;
      }
      case 'stat_pri': u.pri = parseWeapon(value); break;
      case 'stat_sec': u.sec = parseWeapon(value); break;
      case 'stat_pri_attr': u.priAttr = value === 'no' ? [] : splitCsv(value); break;
      case 'stat_sec_attr': u.secAttr = value === 'no' ? [] : splitCsv(value); break;
      case 'stat_pri_armour': {
        const p = splitCsv(value);
        u.armour = Number(p[0]);
        u.skill = Number(p[1]);
        u.shield = Number(p[2]);
        u.armourMat = p[3];
        break;
      }
      case 'stat_mental': {
        const p = splitCsv(value);
        u.morale = Number(p[0]);
        u.discipline = p[1];
        u.training = p[2];
        u.lockMorale = p.includes('lock_morale');
        break;
      }
      case 'stat_ground': u.ground = splitCsv(value).map(Number); break;
      case 'stat_heat': u.heat = Number(value); break;
      case 'stat_charge_dist': u.chargeDist = Number(value); break;
      case 'stat_cost': {
        const p = splitCsv(value).map(Number);
        u.turns = p[0];
        u.cost = p[1];
        u.upkeep = p[2];
        break;
      }
      default: break;
    }
  }
  push();
  return units;
}

// ----------------------------------------------------------------- assembly

function isMissileWeapon(w) {
  return w && w.missile !== 'no' && ['missile', 'thrown', 'siege_missile'].includes(w.type);
}

function cleanText(s) {
  if (!s) return '';
  return s
    .replace(/\\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function buildModel() {
  const names = parseExportUnits(UNITS_TXT);
  const edu = parseEdu(EDU_TXT);
  const cardIndex = buildCardIndex();
  const portraitIndex = buildPortraitIndex();
  const units = [];
  let missingNames = 0;
  let missingCards = 0;
  let missingPortraits = 0;

  for (const u of edu) {
    const dict = (u.dict || u.type).trim();
    const key = dict.toLowerCase();
    const name = names[key] || u.type;
    if (!names[key]) missingNames += 1;
    const card = cardIndex[key] ? cardDataUri(cardIndex[key]) : '';
    if (!card) missingCards += 1;
    const pic = portraitIndex[key] ? exportPortrait(portraitIndex[key], dict) : '';
    if (!pic) missingPortraits += 1;

    // melee weapon = whichever of pri/sec is a melee strike; missile likewise
    let melee = null;
    let missile = null;
    let meleeAttr = [];
    let missileAttr = [];
    if (u.pri && u.pri.type === 'melee') { melee = u.pri; meleeAttr = u.priAttr || []; }
    if (!melee && u.sec && u.sec.type === 'melee') { melee = u.sec; meleeAttr = u.secAttr || []; }
    if (isMissileWeapon(u.pri)) { missile = u.pri; missileAttr = u.priAttr || []; }
    else if (isMissileWeapon(u.sec)) { missile = u.sec; missileAttr = u.secAttr || []; }

    units.push({
      name,
      faction: u.section,
      category: u.category || '',
      class: u.class || '',
      men: u.men || 0,
      extras: u.extras || 0,
      hp: u.hp || 1,
      hpMount: u.hpMount || 0,
      atk: melee ? melee.attack : null,
      chg: melee ? melee.charge : (missile ? missile.charge : null),
      meleeAttr,
      msl: missile ? missile.attack : null,
      rng: missile ? missile.range : null,
      ammo: missile ? missile.ammo : null,
      mslAttr: missileAttr,
      mslName: missile ? missile.missile : null,
      armour: u.armour ?? 0,
      skill: u.skill ?? 0,
      shield: u.shield ?? 0,
      armourMat: u.armourMat || '',
      morale: u.morale ?? 0,
      lockMorale: !!u.lockMorale,
      discipline: u.discipline || '',
      training: u.training || '',
      heat: u.heat ?? 0,
      ground: u.ground || [],
      chargeDist: u.chargeDist ?? null,
      cost: u.cost ?? 0,
      upkeep: u.upkeep ?? 0,
      turns: u.turns ?? 0,
      mount: u.mount || '',
      engine: u.engine || '',
      shipType: u.ship || '',
      vsMounts: u.mountEffect || '',
      formations: u.formations || [],
      card,
      pic,
      attributes: u.attributes || [],
      descr: cleanText(names[`${key}_descr`] || ''),
      short: cleanText(names[`${key}_descr_short`] || ''),
    });
  }

  const factions = [...new Set(units.map((x) => x.faction))];
  return { units, factions, missingNames, missingCards, missingPortraits };
}

// --------------------------------------------------------------------- html

function buildHtml(model) {
  const dataJson = JSON.stringify(model.units);
  const factionsJson = JSON.stringify(model.factions);
  const generated = new Date().toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AGO — Unit Compendium</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<style>
:root {
  --parchment: #f3ecda;
  --parchment-dark: #e9dfc6;
  --row-alt: #eee4cd;
  --ink: #2b2118;
  --ink-soft: #5a4a38;
  --accent: #7a1f1f;
  --gold: #8a6d2f;
  --line: #c9b88f;
  --line-dark: #a89263;
  --good: #2f5d31;
  --bad: #8a2525;
  --serif: 'EB Garamond', Garamond, 'Palatino Linotype', 'Book Antiqua', serif;
  --display: Cinzel, 'Trajan Pro', 'Palatino Linotype', serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--parchment);
  background-image: radial-gradient(ellipse at top, rgba(255,252,240,.6), transparent 60%),
                    radial-gradient(ellipse at bottom, rgba(120,90,40,.10), transparent 60%);
  color: var(--ink);
  font-family: var(--serif);
  font-size: 16px;
  line-height: 1.35;
}
header {
  text-align: center;
  padding: 26px 16px 10px;
  border-bottom: 3px double var(--line-dark);
  background: linear-gradient(var(--parchment-dark), var(--parchment));
}
header h1 {
  font-family: var(--display);
  font-weight: 700;
  font-size: 34px;
  letter-spacing: .12em;
  margin: 0;
  color: var(--accent);
  text-shadow: 0 1px 0 rgba(255,255,255,.5);
}
header .sub {
  font-style: italic;
  color: var(--ink-soft);
  margin: 6px 0 0;
  font-size: 17px;
}
.controls {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  background: var(--parchment-dark);
  border-bottom: 1px solid var(--line-dark);
  box-shadow: 0 2px 6px rgba(60,40,10,.15);
}
.controls label {
  font-family: var(--display);
  font-size: 12px;
  letter-spacing: .08em;
  color: var(--ink-soft);
  text-transform: uppercase;
}
.controls input[type=search], .controls select {
  font-family: var(--serif);
  font-size: 15px;
  color: var(--ink);
  background: #fbf6e7;
  border: 1px solid var(--line-dark);
  border-radius: 3px;
  padding: 4px 8px;
}
.controls input[type=search] { width: 230px; }
.catbtns { display: flex; gap: 0; border: 1px solid var(--line-dark); border-radius: 3px; overflow: hidden; }
.catbtns button {
  font-family: var(--display);
  font-size: 11.5px;
  letter-spacing: .05em;
  padding: 5px 10px;
  background: #fbf6e7;
  border: none;
  border-right: 1px solid var(--line);
  color: var(--ink-soft);
  cursor: pointer;
}
.catbtns button:last-child { border-right: none; }
.catbtns button.active { background: var(--accent); color: #f6eeda; }
.count { font-style: italic; color: var(--ink-soft); font-size: 14px; }
main { max-width: 1280px; margin: 0 auto; padding: 12px 14px 60px; }
table { width: 100%; border-collapse: collapse; }
thead th {
  position: sticky;
  top: 49px;
  z-index: 10;
  font-family: var(--display);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: #f3ead2;
  background: #4a3520;
  padding: 6px 7px;
  border: 1px solid #382818;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
thead th .arrow { font-size: 10px; opacity: .9; }
thead th.num { text-align: right; }
tbody td {
  padding: 3px 7px;
  border: 1px solid var(--line);
  font-size: 15px;
  white-space: nowrap;
}
td.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.unit { cursor: pointer; background: var(--parchment); }
tr.unit:nth-child(even of .unit) { background: var(--row-alt); }
tr.unit:hover { background: #e2d3ac; }
tr.unit.open { background: #ddcda2; }
td.name { font-weight: 600; font-size: 15.5px; }
td.name .cls { font-weight: 400; font-style: italic; color: var(--ink-soft); font-size: 13.5px; }
td.name img.card {
  height: 30px;
  width: 23px;
  object-fit: cover;
  vertical-align: middle;
  margin-right: 7px;
  border: 1px solid var(--line-dark);
  border-radius: 2px;
  background: #2e2418;
}
tr.faction-row td {
  font-family: var(--display);
  font-weight: 700;
  font-size: 15px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--accent);
  background: linear-gradient(90deg, var(--parchment-dark), #f0e7cf 40%, var(--parchment-dark));
  border: 1px solid var(--line-dark);
  border-top: 2px solid var(--line-dark);
  padding: 7px 10px;
  text-align: center;
}
tr.faction-row td .fcount { color: var(--ink-soft); font-size: 12px; letter-spacing: .05em; margin-left: 8px; }
.def-split, .dim { color: var(--ink-soft); font-size: 12.5px; }
.badge {
  display: inline-block;
  font-size: 10.5px;
  font-family: var(--display);
  letter-spacing: .04em;
  border: 1px solid var(--gold);
  color: var(--gold);
  border-radius: 3px;
  padding: 0 3px;
  margin-left: 4px;
  vertical-align: 1px;
}
tr.detail td {
  background: #faf3df;
  border: 1px solid var(--line-dark);
  padding: 12px 18px 14px;
  white-space: normal;
}
.detail-inner { display: flex; gap: 26px; align-items: flex-start; }
.detail-card img {
  width: 170px;
  border: 1px solid var(--line-dark);
  border-radius: 3px;
  background: #2e2418;
  box-shadow: 2px 3px 8px rgba(60,40,10,.3);
}
.detail-card img.small { width: 96px; }
.detail-desc { flex: 1 1 60%; max-width: 70ch; }
.detail-desc .short { font-style: italic; color: var(--ink-soft); margin: 0 0 8px; }
.detail-desc p { margin: 0 0 8px; text-align: justify; hyphens: auto; }
.detail-stats { flex: 1 1 40%; font-size: 14px; }
.detail-stats table { border-collapse: collapse; width: 100%; }
.detail-stats td { border: none; border-bottom: 1px dotted var(--line); padding: 2px 8px 2px 0; white-space: normal; }
.detail-stats td:first-child {
  font-family: var(--display);
  font-size: 10.5px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--ink-soft);
  width: 120px;
  vertical-align: top;
  padding-top: 4px;
}
.empty { text-align: center; font-style: italic; color: var(--ink-soft); padding: 30px; font-size: 17px; }
footer {
  text-align: center;
  font-style: italic;
  color: var(--ink-soft);
  font-size: 13.5px;
  padding: 14px;
  border-top: 3px double var(--line-dark);
}
@media (max-width: 900px) {
  .hide-sm { display: none; }
  .detail-inner { flex-direction: column; }
}
</style>
</head>
<body>
<header>
  <h1>AGO &mdash; Unit Compendium</h1>
  <p class="sub">A field guide to every host of Middle-earth &middot; Medieval II: Total War</p>
</header>

<div class="controls">
  <input type="search" id="q" placeholder="Search units&hellip;" autocomplete="off">
  <span>
    <label for="faction">Faction</label>
    <select id="faction"><option value="">All factions</option></select>
  </span>
  <span class="catbtns" id="cats">
    <button data-cat="" class="active">All</button>
    <button data-cat="infantry">Infantry</button>
    <button data-cat="cavalry">Cavalry</button>
    <button data-cat="missile">Ranged</button>
    <button data-cat="siege">Siege</button>
    <button data-cat="ship">Ships</button>
  </span>
  <span class="count" id="count"></span>
</div>

<main>
  <table id="tbl">
    <thead>
      <tr>
        <th data-k="name">Unit <span class="arrow"></span></th>
        <th data-k="men" class="num" title="In-game soldier count at Huge unit size (data value &times;2.5)">Men <span class="arrow"></span></th>
        <th data-k="atk" class="num">Atk <span class="arrow"></span></th>
        <th data-k="chg" class="num hide-sm">Chg <span class="arrow"></span></th>
        <th data-k="msl" class="num">Msl <span class="arrow"></span></th>
        <th data-k="rng" class="num hide-sm">Rng <span class="arrow"></span></th>
        <th data-k="ammo" class="num hide-sm">Ammo <span class="arrow"></span></th>
        <th data-k="def" class="num">Def <span class="arrow"></span></th>
        <th data-k="morale" class="num">Mor <span class="arrow"></span></th>
        <th data-k="hp" class="num hide-sm">HP <span class="arrow"></span></th>
        <th data-k="cost" class="num">Cost <span class="arrow"></span></th>
        <th data-k="upkeep" class="num">Upkeep <span class="arrow"></span></th>
        <th data-k="turns" class="num hide-sm">Turns <span class="arrow"></span></th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="empty" id="empty" hidden>No units match these filters.</div>
</main>

<footer>Soldier counts shown at Huge unit size (game scales data values &times;2.5) &middot; Generated ${generated} from <code>export_descr_unit.txt</code> &amp; <code>export_units.txt</code> &middot; ${model.units.length} units &middot; rebuild with <code>node build.js</code></footer>

<script>
const UNITS = ${dataJson};
const FACTIONS = ${factionsJson};
// In-game soldier counts are the data-file numbers scaled by the unit-size
// setting; this site shows Huge (x2.5), the scale the mod is balanced around.
const SIZE_SCALE = 2.5;
const inGame = (n) => Math.round(n * SIZE_SCALE);
UNITS.forEach((u, i) => { u.id = i; u.def = u.armour + u.skill + u.shield; });

const state = { q: '', faction: '', cat: '', sortKey: null, sortDir: 1, open: new Set() };

const $faction = document.getElementById('faction');
for (const f of FACTIONS) {
  const n = UNITS.filter(u => u.faction === f).length;
  const o = document.createElement('option');
  o.value = f;
  o.textContent = f + ' (' + n + ')';
  $faction.appendChild(o);
}

function unitCat(u) {
  if (u.category === 'ship' || u.shipType) return 'ship';
  if (u.category === 'siege') return 'siege';
  return u.category;
}
function isRanged(u) { return u.msl !== null; }

function matches(u) {
  if (state.faction && u.faction !== state.faction) return false;
  if (state.cat === 'missile') { if (!isRanged(u) || unitCat(u) === 'ship') return false; }
  else if (state.cat && unitCat(u) !== state.cat) return false;
  if (state.q) {
    const q = state.q.toLowerCase();
    if (!u.name.toLowerCase().includes(q) && !u.faction.toLowerCase().includes(q)) return false;
  }
  return true;
}

function typeLabel(u) {
  const cat = unitCat(u);
  if (cat === 'ship') return 'Ship';
  if (cat === 'siege') return 'Siege';
  if (cat === 'handler') return 'Beast handlers';
  const cls = { light: 'Light', heavy: 'Heavy', missile: 'Ranged', spearmen: 'Spear' }[u.class] || u.class;
  const c = { infantry: 'infantry', cavalry: 'cavalry' }[cat] || cat;
  return cls + ' ' + c;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function badges(attrs) {
  let h = '';
  if (attrs.includes('ap')) h += '<span class="badge" title="Armour-piercing: ignores half of target armour">AP</span>';
  if (attrs.includes('bp')) h += '<span class="badge" title="Body-piercing: missiles pass through men">BP</span>';
  if (attrs.some(a => a === 'spear' || a === 'light_spear' || a === 'short_pike' || a === 'long_pike')) {
    h += '<span class="badge" title="Spear: bonus against cavalry">SP</span>';
  }
  const sb = attrs.find(a => a.startsWith('spear_bonus'));
  if (sb) h += '<span class="badge" title="Bonus vs cavalry">+' + sb.split('_').pop() + 'c</span>';
  return h;
}

function fmt(v) { return v === null || v === undefined ? '<span class="dim">—</span>' : v; }

function rowHtml(u) {
  const def = u.def + ' <span class="def-split">(' + u.armour + '·' + u.skill + '·' + u.shield + ')</span>';
  const mounted = u.mount || u.extras > 0;
  const hp = mounted && u.hpMount > u.hp ? u.hp + '<span class="def-split">/' + u.hpMount + '</span>' : u.hp;
  const men = u.extras ? inGame(u.men) + '<span class="def-split">+' + inGame(u.extras) + '</span>' : inGame(u.men);
  const mor = u.lockMorale ? u.morale + '<span class="badge" title="Morale locked: this unit never routs">&#8734;</span>' : u.morale;
  const card = u.card ? '<img class="card" loading="lazy" alt="" src="' + u.card + '">' : '';
  return '<tr class="unit' + (state.open.has(u.id) ? ' open' : '') + '" data-id="' + u.id + '">' +
    '<td class="name">' + card + esc(u.name) + ' <span class="cls">' + typeLabel(u) + '</span></td>' +
    '<td class="num">' + men + '</td>' +
    '<td class="num">' + fmt(u.atk) + badges(u.meleeAttr) + '</td>' +
    '<td class="num hide-sm">' + fmt(u.chg) + '</td>' +
    '<td class="num">' + fmt(u.msl) + (u.msl !== null ? badges(u.mslAttr) : '') + '</td>' +
    '<td class="num hide-sm">' + fmt(u.rng) + '</td>' +
    '<td class="num hide-sm">' + fmt(u.ammo) + '</td>' +
    '<td class="num">' + def + '</td>' +
    '<td class="num">' + mor + '</td>' +
    '<td class="num hide-sm">' + hp + '</td>' +
    '<td class="num">' + u.cost + '</td>' +
    '<td class="num">' + u.upkeep + '</td>' +
    '<td class="num hide-sm">' + u.turns + '</td>' +
  '</tr>';
}

const ATTR_NOTES = {
  frighten_foot: 'frightens infantry', frighten_mounted: 'frightens cavalry',
  hardy: 'hardy', very_hardy: 'very hardy', extreme_hardy: 'extremely hardy',
  can_run_amok: 'may run amok', command: 'inspires nearby units (banner)',
  hide_anywhere: 'hides anywhere', hide_improved_forest: 'hides well in forest',
  hide_forest: 'hides in forest', can_sap: 'can sap walls',
  free_upkeep_unit: 'free upkeep in cities', mercenary_unit: 'mercenary',
  general_unit: 'can serve as bodyguard', can_formed_charge: 'formed charge',
  can_swim: 'can swim', is_peasant: 'peasant', no_custom: 'not in custom battles',
  cantabrian_circle: 'cantabrian circle', power_charge: 'powerful charge',
  can_horde: 'horde unit', artillery: 'artillery', sea_faring: '', can_withdraw: '',
  start_not_skirmishing: '', legionary_name: '', gunpowder_unit: 'gunpowder',
  bodyguard_unit: 'bodyguard',
};

function detailHtml(u) {
  const paras = u.descr ? u.descr.split(/\\n+/).map(p => '<p>' + esc(p) + '</p>').join('') : '<p class="dim">No description.</p>';
  const notes = u.attributes.map(a => ATTR_NOTES[a] === undefined ? a.replace(/_/g, ' ') : ATTR_NOTES[a]).filter(Boolean);
  const rows = [];
  const add = (k, v) => { if (v !== null && v !== undefined && v !== '') rows.push('<tr><td>' + k + '</td><td>' + v + '</td></tr>'); };
  add('Faction', esc(u.faction));
  add('Soldiers', inGame(u.men) + (u.extras ? ' + ' + inGame(u.extras) + ' engine/beast' : '') +
    ' <span class="dim">(' + u.men + (u.extras ? '+' + u.extras : '') + ' in data ×' + SIZE_SCALE + ')</span>' +
    ((u.mount || u.extras > 0) && u.hpMount > u.hp ? ' · mount/beast ' + u.hpMount + ' hp' : ''));
  if (u.atk !== null) add('Melee', 'attack ' + u.atk + ', charge ' + u.chg + (u.meleeAttr.length ? ' · ' + u.meleeAttr.join(', ') : ''));
  if (u.msl !== null) add('Ranged', 'attack ' + u.msl + ', range ' + u.rng + ', ' + u.ammo + ' ammo' + (u.mslAttr.length ? ' · ' + u.mslAttr.join(', ') : ''));
  add('Defence', u.def + ' = armour ' + u.armour + ' + skill ' + u.skill + ' + shield ' + u.shield + (u.armourMat ? ' (' + u.armourMat + ')' : ''));
  add('Morale', u.morale + (u.lockMorale ? ' (locked — never routs)' : '') + ' · ' + u.discipline + ' · ' + u.training.replace(/_/g, ' '));
  if (u.vsMounts) add('Vs mounts', esc(u.vsMounts));
  if (u.formations.length) add('Formations', u.formations.map(f => f.replace(/_/g, ' ')).join(', '));
  if (u.mount) add('Mount', esc(u.mount));
  if (u.engine) add('Engine', esc(u.engine.replace(/_/g, ' ')));
  add('Recruitment', u.cost + ' gold · ' + u.upkeep + ' upkeep · ' + u.turns + (u.turns === 1 ? ' turn' : ' turns'));
  if (u.heat) add('Heat fatigue', '-' + u.heat);
  if (u.ground.length === 4) {
    const g = u.ground.map((v, i) => v ? ['scrub', 'sand', 'forest', 'snow'][i] + ' ' + (v > 0 ? '+' : '') + v : '').filter(Boolean).join(', ');
    if (g) add('Terrain', g);
  }
  if (notes.length) add('Traits', notes.join(', '));
  // Prefer the large unit_info portrait; fall back to the embedded card if the
  // portraits/ folder is missing (e.g. the site was shared as index.html alone).
  let card = '';
  if (u.pic) {
    card = '<div class="detail-card"><img alt="" loading="lazy" data-fb="' + u.id + '" src="' + u.pic + '"></div>';
  } else if (u.card) {
    card = '<div class="detail-card"><img alt="" class="small" src="' + u.card + '"></div>';
  }
  return '<tr class="detail"><td colspan="13"><div class="detail-inner">' + card +
    '<div class="detail-desc">' + (u.short ? '<p class="short">' + esc(u.short) + '</p>' : '') + paras + '</div>' +
    '<div class="detail-stats"><table>' + rows.join('') + '</table></div>' +
  '</div></td></tr>';
}

function render() {
  const list = UNITS.filter(matches);
  let html = '';
  if (state.sortKey) {
    const k = state.sortKey;
    const dir = state.sortDir;
    list.sort((a, b) => {
      const av = a[k], bv = b[k];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
    for (const u of list) {
      html += rowHtml(u);
      if (state.open.has(u.id)) html += detailHtml(u);
    }
  } else {
    let cur = null;
    for (const u of list) {
      if (u.faction !== cur) {
        cur = u.faction;
        const n = list.filter(x => x.faction === cur).length;
        html += '<tr class="faction-row"><td colspan="13">' + esc(cur) + '<span class="fcount">' + n + (n === 1 ? ' unit' : ' units') + '</span></td></tr>';
      }
      html += rowHtml(u);
      if (state.open.has(u.id)) html += detailHtml(u);
    }
  }
  document.getElementById('rows').innerHTML = html;
  document.getElementById('empty').hidden = list.length > 0;
  document.getElementById('count').textContent = list.length + ' of ' + UNITS.length + ' units';
  for (const th of document.querySelectorAll('thead th')) {
    th.querySelector('.arrow').textContent = th.dataset.k === state.sortKey ? (state.sortDir > 0 ? '\\u25B4' : '\\u25BE') : '';
  }
}

document.getElementById('q').addEventListener('input', (e) => { state.q = e.target.value.trim(); render(); });
$faction.addEventListener('change', (e) => { state.faction = e.target.value; render(); });
document.getElementById('cats').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.cat = b.dataset.cat;
  for (const x of document.querySelectorAll('.catbtns button')) x.classList.toggle('active', x === b);
  render();
});
document.querySelector('thead').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th) return;
  const k = th.dataset.k;
  if (state.sortKey === k) {
    if (state.sortDir === -1) { state.sortKey = null; state.sortDir = 1; } // third click: back to faction grouping
    else state.sortDir = -1;
  } else {
    state.sortKey = k;
    state.sortDir = k === 'name' ? 1 : -1; // numeric columns: best first
  }
  render();
});
// Portrait failed to load (portraits/ folder absent) -> swap in the embedded card.
document.getElementById('rows').addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.fb) return;
  const u = UNITS[Number(img.dataset.fb)];
  delete img.dataset.fb;
  if (u && u.card) { img.src = u.card; img.className = 'small'; }
  else img.closest('.detail-card')?.remove();
}, true);

document.getElementById('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr.unit');
  if (!tr) return;
  const id = Number(tr.dataset.id);
  if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
  render();
});

render();
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------- run

const model = buildModel();
fs.writeFileSync(OUT_HTML, buildHtml(model), 'utf8');
console.log(`Parsed ${model.units.length} units across ${model.factions.length} sections.`);
if (model.missingNames) console.log(`${model.missingNames} units had no entry in export_units.txt (internal name used).`);
if (model.missingCards) console.log(`${model.missingCards} units had no card image in data/ui/units/mercs.`);
if (model.missingPortraits) console.log(`${model.missingPortraits} units had no portrait in data/ui/unit_info/merc.`);
if (fs.existsSync(OUT_PORTRAITS)) {
  const pics = fs.readdirSync(OUT_PORTRAITS).filter((f) => f.endsWith('.png'));
  const mb = pics.reduce((s, f) => s + fs.statSync(path.join(OUT_PORTRAITS, f)).size, 0) / 1048576;
  console.log(`portraits/: ${pics.length} PNGs, ${mb.toFixed(0)} MB`);
}
console.log(`Wrote ${OUT_HTML} (${(fs.statSync(OUT_HTML).size / 1024).toFixed(0)} KB)`);
