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
const EOP_SCRIPTS = path.join(MOD_ROOT, 'eopData', 'eopScripts');
const PROJ_TXT = path.join(MOD_ROOT, 'data', 'descr_projectile.txt');
const MOUNT_TXT = path.join(MOD_ROOT, 'data', 'descr_mount.txt');
const EDB_TXT = path.join(MOD_ROOT, 'data', 'export_descr_buildings.txt');
const BUILDINGS_TXT = path.join(MOD_ROOT, 'data', 'text', 'export_buildings.txt');
const SM_FACTIONS_TXT = path.join(MOD_ROOT, 'data', 'descr_sm_factions.txt');
const MERC_TXT = path.join(MOD_ROOT, 'data', 'world', 'maps', 'campaign', 'imperial_campaign', 'descr_mercenaries.txt');
const GUILDS_TXT = path.join(MOD_ROOT, 'data', 'export_descr_guilds.txt');
const CAMPAIGN_DESCR_TXT = path.join(MOD_ROOT, 'data', 'text', 'campaign_descriptions.txt');
const FACTION_SYMBOL_DIR = path.join(MOD_ROOT, 'data', 'ui', 'faction_symbols');
const OUT_FHTML = path.join(__dirname, 'factions.html');
const OUT_FPICS = path.join(__dirname, 'factionpics');
const CARD_DIR = path.join(MOD_ROOT, 'data', 'ui', 'units', 'mercs');
const PORTRAIT_DIR = path.join(MOD_ROOT, 'data', 'ui', 'unit_info', 'merc');
const OUT_HTML = path.join(__dirname, 'index.html');
const OUT_BHTML = path.join(__dirname, 'buildings.html');
const OUT_PORTRAITS = path.join(__dirname, 'portraits');
const OUT_CARDS = path.join(__dirname, 'cards');
const OUT_BPICS = path.join(__dirname, 'buildingpics');

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

function buildPortraitIndex() {
  const index = {};
  if (!fs.existsSync(PORTRAIT_DIR)) return index;
  for (const f of fs.readdirSync(PORTRAIT_DIR)) {
    const m = f.match(/^(.+)_info\.tga$/i);
    if (m) index[m[1].toLowerCase()] = path.join(PORTRAIT_DIR, f);
  }
  return index;
}

// Converts a TGA to <outDir>/<dict>.png (skipped when up to date).
// Returns the relative href, or '' on failure.
function exportImage(tgaFile, dict, outDir, hrefBase) {
  const safe = dict.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const outFile = path.join(outDir, safe + '.png');
  const href = hrefBase + '/' + safe + '.png';
  try {
    if (fs.existsSync(outFile) && fs.statSync(outFile).mtimeMs >= fs.statSync(tgaFile).mtimeMs) {
      return href;
    }
    const tga = decodeTga(fs.readFileSync(tgaFile));
    if (!tga) return '';
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outFile, encodePng(tga));
    return href;
  } catch {
    return '';
  }
}

const exportPortrait = (tgaFile, dict) => exportImage(tgaFile, dict, OUT_PORTRAITS, 'portraits');
const exportCard = (tgaFile, dict) => exportImage(tgaFile, dict, OUT_CARDS, 'cards');

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
  return parseEduText(fs.readFileSync(file, 'latin1'), 'Miscellaneous');
}

function parseEduText(text, startSection) {
  const units = [];
  let section = startSection;
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
    const value = kv[2].split(';')[0].trim(); // strip inline comments
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
      case 'move_speed_mod': u.moveSpeed = Number(value); break;
      case 'ownership': u.ownership = splitCsv(value); break;
      case 'era 0': u.era0 = splitCsv(value)[0]; break;
      case 'armour_ug_levels': u.armourUg = splitCsv(value).map(Number); break;
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

// ------------------------------------------------------ reference data

// descr_projectile.txt: the ammunition fired by every missile weapon.
function parseProjectiles(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  let p = null;
  for (const raw of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const line = raw.split(';')[0].trimEnd();
    if (!line.trim()) continue;
    const head = line.match(/^projectile\s+(\S+)/);
    if (head) { p = out[head[1].toLowerCase()] = { name: head[1], flags: [] }; continue; }
    if (!p) continue;
    const kv = line.trim().match(/^(\S+)\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    switch (kv[1].toLowerCase()) {
      case 'damage': p.damage = Number(v); break;
      case 'mass': p.mass = Number(v); break;
      case 'accuracy_vs_units': p.accuracy = Number(v); break;
      case 'velocity': p.velocity = v.split(/\s+/).map(Number); break;
      case 'fiery': p.flags.push('fire'); break;
      case 'body_piercing': p.flags.push('body-piercing'); break;
      case 'area_effect': p.flags.push('area effect'); break;
      default: break;
    }
  }
  // name-derived specials (matches the in-game tooltips driven by EOP)
  for (const p2 of Object.values(out)) {
    const n = p2.name.toLowerCase();
    if (n.includes('poison')) p2.flags.push('poison');
    if (n.includes('silverthorn')) p2.flags.push('silverthorn');
    if (n.includes('multi')) p2.flags.push('splitshot');
  }
  return out;
}

// descr_mount.txt: every horse/warg/beast design ridden in the mod.
function parseMounts(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  let m = null;
  for (const raw of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const line = raw.split(';')[0].trimEnd();
    if (!line.trim()) continue;
    const head = line.match(/^type\s+(.+)$/);
    if (head) { m = out[head[1].trim().toLowerCase()] = { name: head[1].trim(), riders: 1 }; continue; }
    if (!m) continue;
    const kv = line.trim().match(/^(\S+)\s+(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    switch (kv[1].toLowerCase()) {
      case 'class': m.class = v; break;
      case 'mass': m.mass = Number(v); break;
      case 'radius': m.radius = Number(v); break;
      case 'height': m.height = Number(v); break;
      case 'riders': m.riders = Number(v); break;
      default: break;
    }
  }
  return out;
}

// ------------------------------------------------------------- recruitment

// Curated building effects (key -> display label). Anything not listed is a
// structural or remap-artifact line we deliberately skip.
const EFFECT_LABELS = {
  wall_level: 'Walls', tower_level: 'Towers',
  gate_strength: 'Gate strength', gate_defences: 'Gate defences',
  law_bonus: 'Law', happiness_bonus: 'Happiness',
  population_growth_bonus: 'Growth', population_health_bonus: 'Health',
  population_loyalty_bonus: 'Loyalty',
  trade_base_income_bonus: 'Trade', taxable_income_bonus: 'Tax',
  income_bonus: 'Income', mine_resource: 'Mining',
  farming_level: 'Farming', road_level: 'Roads',
  free_upkeep: 'Free upkeep', recruits_morale_bonus: 'Recruit morale',
  recruits_exp_bonus: 'Recruit exp', recruitment_slots: 'Recruit slots',
  retrain_cost_bonus: 'Retrain cost',
  armour: 'Armour upgrades',
  weapon_melee_simple: 'Weapon upgrades (simple)',
  weapon_melee_blade: 'Weapon upgrades (bladed)',
  weapon_missile_mechanical: 'Weapon upgrades (missile)',
  weapon_missile_gunpowder: 'Weapon upgrades (engines)',
  weapon_artillery_mechanical: 'Weapon upgrades (artillery)',
  religion_level: 'Influence', amplify_religion_level: 'Influence spread',
  construction_cost_bonus_wooden: 'Wooden build cost',
  construction_cost_bonus_stone: 'Stone build cost',
  construction_time_bonus_military: 'Military build time',
  construction_time_bonus_religious: 'Religious build time',
  construction_time_bonus_defensive: 'Defensive build time',
  construction_time_bonus_other: 'Civil build time',
  stage_games: 'Stages games', stage_races: 'Stages races',
  archer_bonus: 'Archer exp', cavalry_bonus: 'Cavalry exp',
  heavy_cavalry_bonus: 'Heavy cavalry exp',
  trade_fleet: 'Trade fleet', recruitment_cost_bonus_naval: 'Ship cost',
  fire_risk: 'Fire risk',
};
// keys whose value is a tier ("level 2"), a percent discount, or a plain flag
const LEVEL_KEYS = new Set(['wall_level', 'tower_level', 'farming_level', 'road_level',
  'armour', 'weapon_melee_simple', 'weapon_melee_blade', 'weapon_missile_mechanical',
  'weapon_missile_gunpowder', 'weapon_artillery_mechanical', 'mine_resource']);
const PCT_KEYS = new Set(['construction_cost_bonus_wooden', 'construction_cost_bonus_stone',
  'construction_time_bonus_military', 'construction_time_bonus_religious',
  'construction_time_bonus_defensive', 'construction_time_bonus_other',
  'recruitment_cost_bonus_naval', 'retrain_cost_bonus']);
const FLAG_KEYS = new Set(['stage_games', 'stage_races']);

// export_descr_buildings.txt: every building chain with its levels, tiers,
// construction cost/time, curated effects and recruit pools. Returns both the
// full chain model (buildings page) and a per-unit pool index (unit page).
function parseEdb(file) {
  const byUnit = {};
  const chains = [];
  if (!fs.existsSync(file)) return { byUnit, chains };
  let chain = null;
  let levels = [];
  let cur = null;
  const condInfo = (conds) => {
    const facs = ((conds.match(/factions\s*\{([^}]*)\}/) || [])[1] || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const hr = [...conds.matchAll(/(not\s+)?hidden_resource\s+(\S+)/g)]
      .filter((x) => !x[1]).map((x) => x[2]);
    const evAll = [...conds.matchAll(/(not\s+)?event_counter\s+(\S+)/g)];
    const aiOnly = evAll.some((x) => !x[1] && x[2] === 'is_the_ai');
    const ev = evAll.filter((x) => !x[1] && x[2] !== 'is_the_ai').map((x) => x[2]);
    return { facs, hr, ev, aiOnly };
  };
  for (const raw of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const t = raw.split(';')[0].trim();
    if (!t) continue;
    let m;
    if ((m = t.match(/^building\s+(\S+)/))) {
      chain = { name: m[1], levels: [] };
      chains.push(chain);
      levels = [];
      cur = null;
      continue;
    }
    if (chain && (m = t.match(/^levels\s+(.+)$/))) { levels = m[1].trim().split(/\s+/); continue; }
    const first = t.split(/\s+/)[0];
    if (chain && levels.includes(first) && /\brequires\b/.test(t)) {
      const second = t.split(/\s+/)[1];
      const ci = condInfo(t.slice(t.indexOf('requires')));
      cur = {
        level: first,
        kind: second === 'castle' ? 'castle' : second === 'city' ? 'city' : '',
        tier: levels.indexOf(first) + 1,
        of: levels.length,
        facs: ci.facs, hr: ci.hr, ev: ci.ev,
        cost: 0, time: 0, min: '',
        effects: [], recruits: [],
      };
      chain.levels.push(cur);
      continue;
    }
    if (!cur) continue;
    if ((m = t.match(/^recruit_pool\s+"([^"]+)"\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+requires\s+(.*)$/))) {
      const ci = condInfo(m[6]);
      if (ci.aiOnly) continue; // AI-only pool
      const rec = { rate: Number(m[3]), max: Number(m[4]), exp: Number(m[5]), facs: ci.facs, hr: ci.hr, ev: ci.ev };
      const unit = m[1].toLowerCase();
      (byUnit[unit] = byUnit[unit] || []).push({
        chain: chain.name, level: cur.level, tier: cur.tier, of: cur.of, kind: cur.kind, ...rec,
      });
      cur.recruits.push({ unit: m[1], ...rec });
      continue;
    }
    if ((m = t.match(/^construction\s+(\d+)/))) { cur.time = Number(m[1]); continue; }
    if ((m = t.match(/^cost\s+(\d+)/))) { cur.cost = Number(m[1]); continue; }
    if ((m = t.match(/^settlement_min\s+(\w+)/))) { cur.min = m[1]; continue; }
    if ((m = t.match(/^([a-z_]+)\s+(?:bonus\s+)?(-?\d+)(?:\s+requires\s+(.*))?$/)) && EFFECT_LABELS[m[1]]) {
      const ci = m[3] ? condInfo('requires ' + m[3]) : { facs: [], hr: [], ev: [], aiOnly: false };
      if (ci.aiOnly) continue;
      cur.effects.push({ key: m[1], val: Number(m[2]), cond: (m[3] || '').trim() });
    }
  }
  return { byUnit, chains };
}

// eopData guild scripts: how guild points are earned. guildData.lua holds
// modder-written "influenceActions" descriptions plus faction ownership via
// F_* constants, which factionData.lua resolves to vanilla faction tags.
function parseGuildTriggers() {
  const facFile = path.join(EOP_SCRIPTS, 'Campaign', 'factionData.lua');
  const guildFile = path.join(EOP_SCRIPTS, 'Campaign', 'Guilds', 'guildData.lua');
  const byChain = {};
  if (!fs.existsSync(facFile) || !fs.existsSync(guildFile)) return byChain;
  const facLua = fs.readFileSync(facFile, 'utf8');
  // f_highelves -> "saxons"
  const keyToTag = {};
  for (const m of facLua.matchAll(/(f_\w+)\s*=\s*factionData:new\s*\{[\s\S]*?name\s*=\s*"(\w+)"/g)) {
    keyToTag[m[1]] = m[2];
  }
  // F_HIGHELVES -> f_highelves
  const constToKey = {};
  for (const m of facLua.matchAll(/(F_\w+)\s*=\s*FACTION\.data\.(f_\w+)/g)) {
    constToKey[m[1]] = m[2];
  }
  const lua = fs.readFileSync(guildFile, 'utf8');
  const starts = [...lua.matchAll(/\w+\s*=\s*guildData:new\s*\{/g)];
  for (let i = 0; i < starts.length; i++) {
    const seg = lua.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : undefined);
    const chain = (seg.match(/buildingName\s*=\s*"([^"]+)"/) || [])[1];
    if (!chain) continue;
    const how = [...((seg.match(/influenceActions\s*=\s*\{([\s\S]*?)\}/) || [])[1] || '').matchAll(/"([^"]*)"/g)]
      .map((m) => m[1].replace(/^\s*-\s*/, '').trim()).filter(Boolean);
    const facTags = [...((seg.match(/factionOwnership\s*=\s*\{([\s\S]*?)\}/) || [])[1] || '').matchAll(/(F_\w+)\.name/g)]
      .map((m) => keyToTag[constToKey[m[1]]]).filter(Boolean);
    byChain[chain] = {
      gname: (seg.match(/displayName\s*=\s*"([^"]+)"/) || [])[1] || '',
      how,
      facTags,
    };
  }
  return byChain;
}

// eopData factionData.lua: per-faction side (good/evil), curated unit tiers
// and historic capitals, keyed by the vanilla faction tag.
function parseFactionLua() {
  const file = path.join(EOP_SCRIPTS, 'Campaign', 'factionData.lua');
  const out = {};
  if (!fs.existsSync(file)) return out;
  const lua = fs.readFileSync(file, 'utf8');
  const starts = [...lua.matchAll(/f_\w+\s*=\s*factionData:new\s*\{/g)];
  for (let i = 0; i < starts.length; i++) {
    const seg = lua.slice(starts[i].index, i + 1 < starts.length ? starts[i + 1].index : undefined);
    const tag = (seg.match(/name\s*=\s*"(\w+)"/) || [])[1];
    if (!tag) continue;
    const list = (key) => [...((seg.match(new RegExp(key + '\\s*=\\s*\\{([^}]*)\\}')) || [])[1] || '')
      .matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((n) => !/\.\w{3}$/.test(n)); // skip stray asset filenames
    out[tag] = {
      side: /side\s*=\s*factionSides\.good/.test(seg) ? 'good'
        : /side\s*=\s*factionSides\.(sauron|saruman|evil)/.test(seg) ? 'evil'
        : /side\s*=\s*factionSides\.neutral/.test(seg) ? 'neutral' : '',
      low: list('lowTierUnits'), mid: list('midTierUnits'), high: list('highTierUnits'),
      capitals: list('historicCapitals'),
    };
  }
  return out;
}

// Each faction's reachable armour-upgrade tier, scanned across every chain's
// `armour` capability lines (factions differ widely: the smith chain caps some
// at level 3 and others at 5, with event-unlocked levels beyond). Levels gated
// by region, event or guild membership count as conditional extras.
function smithingSummary(chains, ownerMap, guilds, cultures) {
  const all = Object.keys(ownerMap);
  // factions clauses sometimes name a culture instead of a faction tag
  const expand = (facs) => all.filter((t) => facs.includes(t) || facs.includes(cultures[t]));
  const out = {};
  for (const t of all) out[t] = { base: 0, cond: 0, chain: '', tier: 0 };
  for (const chain of chains) {
    // script-placed unique chains (every level free) aren't normally buildable
    const scripted = chain.levels.every((l) => !l.cost);
    const guild = !!guilds[chain.name];
    for (const l of chain.levels) {
      const gated = guild || scripted || l.hr.some((h) => h !== 'unlocked') || l.ev.length > 0;
      // a level restricted to some factions can only grant effects to those
      const ltags = l.facs.length ? new Set(expand(l.facs)) : null;
      for (const e of l.effects) {
        if (e.key !== 'armour') continue;
        const efacs = effectFacs(e.cond);
        let tags = efacs.length ? expand(efacs) : ltags ? [...ltags] : all;
        if (ltags) tags = tags.filter((t) => ltags.has(t));
        const condEff = /event_counter|hidden_resource/.test(e.cond);
        for (const t of tags) {
          const s = out[t];
          if (gated || condEff) { if (e.val > s.cond) s.cond = e.val; }
          else if (e.val > s.base) { s.base = e.val; s.chain = chain.name; s.tier = l.tier; }
        }
      }
    }
  }
  return out;
}

// Faction overview model: campaign_descriptions.txt blurbs + factionData.lua
// tiers + roster counts from the unit model.
function buildFactionsModel(units, ownerMap, unitsByType, chains, buildings, guilds, cultures) {
  const smithing = smithingSummary(chains, ownerMap, guilds, cultures);
  const chainBySlug = new Map(buildings.map((b) => [b.slug, b]));
  const cdesc = parseExportUnits(CAMPAIGN_DESCR_TXT);
  const facLua = parseFactionLua();
  const sectionOrder = [...new Set(units.map((u) => u.faction))];
  const byName = {};
  for (const u of units) if (!byName[u.name.toLowerCase()]) byName[u.name.toLowerCase()] = u;
  // Lua lists mix EDU type names ("Dunedain Rangers") and display names
  // ("Dúnedain Rangers"), sometimes with a parenthetical note appended.
  const linkify = (names) => names.map((n) => {
    const bare = n.replace(/\s*\(.*\)$/, '').trim().toLowerCase();
    const u = byName[n.toLowerCase()] || byName[bare] || unitsByType[n.toLowerCase()] || unitsByType[bare];
    return { n: u && u.name ? u.name : n, s: u ? u.slug : '' };
  });
  const out = [];
  for (const key of Object.keys(cdesc)) {
    const m = key.match(/^imperial_campaign_(\w+)_descr$/);
    if (!m) continue;
    const tag = m[1];
    const section = ownerMap[tag];
    if (!section) continue;
    const title = (cdesc[`imperial_campaign_${tag}_title`] || section).trim();
    const descr = cleanText(cdesc[key]);
    const roster = units.filter((u) => u.faction === section);
    if (!roster.length) continue;
    const lua = facLua[tag] || { side: '', low: [], mid: [], high: [], capitals: [] };
    const counts = { total: roster.length, infantry: 0, cavalry: 0, ranged: 0, siege: 0, ships: 0 };
    for (const u of roster) {
      if (u.category === 'ship' || u.shipType) counts.ships += 1;
      else if (u.category === 'siege') counts.siege += 1;
      else if (u.msl !== null && u.category === 'infantry') counts.ranged += 1;
      else if (u.category === 'cavalry') counts.cavalry += 1;
      else counts.infantry += 1;
    }
    const symTga = path.join(FACTION_SYMBOL_DIR, tag + '.tga');
    const sm = smithing[tag] || { base: 0, cond: 0, chain: '', tier: 0 };
    const smSlug = sm.chain ? chainSlug(sm.chain) : '';
    const smChain = chainBySlug.get(smSlug);
    // name the tier that actually grants the level, resolved for this faction
    const smLvl = smChain && smChain.levels[sm.tier - 1];
    out.push({
      slug: chainSlug(title),
      section,
      name: title,
      side: lua.side,
      sym: fs.existsSync(symTga) ? exportImage(symTga, tag, OUT_FPICS, 'factionpics') : '',
      leader: ((descr.match(/Leader:\s*([^\n]+)/) || [])[1] || '').trim(),
      heir: ((descr.match(/Heir:\s*([^\n]+)/) || [])[1] || '').trim(),
      capital: ((descr.match(/Capital:\s*([^\n]+)/) || [])[1] || '').trim(),
      counts,
      smith: {
        base: sm.base,
        cond: sm.cond > sm.base ? sm.cond : 0,
        slug: smChain ? smSlug : '',
        cname: smLvl ? (smLvl.names[section] || smLvl.name) : '',
      },
      low: linkify(lua.low), mid: linkify(lua.mid), high: linkify(lua.high),
      descr,
    });
  }
  out.sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section));
  return out;
}

// export_descr_guilds.txt: guild -> its building chain and the guild-point
// thresholds at which each level is offered.
function parseGuilds(file) {
  const byChain = {};
  if (!fs.existsSync(file)) return byChain;
  let guild = null;
  for (const raw of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const t = raw.split(';')[0].trim();
    let m;
    if ((m = t.match(/^Guild\s+(\S+)/i))) guild = { name: m[1], points: [] };
    else if (guild && (m = t.match(/^building\s+(\S+)/))) byChain[m[1]] = guild;
    else if (guild && (m = t.match(/^levels\s+(.+)$/))) guild.points = m[1].trim().split(/\s+/).map(Number);
  }
  return byChain;
}

// descr_sm_factions.txt: vanilla faction tag -> culture (building names are
// culture-suffixed in export_buildings.txt) and religion (mercenary pools are
// gated by religion).
function parseFactionCultures(file) {
  const map = { culture: {}, religion: {} };
  if (!fs.existsSync(file)) return map;
  let faction = null;
  for (const raw of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const t = raw.split(';')[0].trim();
    let m;
    if ((m = t.match(/^faction\s+(\S+?),?\s*$/))) faction = m[1];
    else if (faction && (m = t.match(/^culture\s+(\S+)/))) map.culture[faction] = m[1];
    else if (faction && (m = t.match(/^religion\s+(\S+)/))) map.religion[faction] = m[1];
  }
  return map;
}

// descr_mercenaries.txt: region-based pools of mercenaries hired in the field
// by an army's captain. Availability is gated by the hiring faction's religion
// tag and sometimes by an event counter.
function parseMercs(file, knownReligions) {
  const entries = {};
  if (!fs.existsSync(file)) return entries;
  let regions = [];
  for (const raw of fs.readFileSync(file, 'latin1').split(/\r?\n/)) {
    const t = raw.split(';')[0].trim();
    if (!t) continue;
    let m;
    if (/^pool\s+/.test(t)) { regions = []; continue; }
    if ((m = t.match(/^regions\s+(.+)$/))) { regions = m[1].trim().split(/\s+/); continue; }
    if ((m = t.match(/^unit\s+(.+?),?\s+exp\s+(\d+)\s+cost\s+(\d+)\s+replenish\s+([\d.]+)\s*-\s*([\d.]+)\s+max\s+(\d+)\s+initial\s+(\d+)(.*)$/))) {
      const unit = m[1].trim().toLowerCase();
      const rest = m[8];
      let religions = ((rest.match(/religions\s*\{([^}]*)\}/) || [])[1] || '').trim().split(/\s+/).filter(Boolean);
      let events = ((rest.match(/events\s*\{([^}]*)\}/) || [])[1] || '').trim().split(/\s+/).filter(Boolean);
      // mod typo guard: religion tags written inside an events block
      if (events.length && events.every((e) => knownReligions.has(e))) { religions = events; events = []; }
      const rates = [Number(m[4]), Number(m[5])].sort((a, b) => a - b);
      (entries[unit] = entries[unit] || []).push({
        regions, exp: Number(m[2]), cost: Number(m[3]),
        repMin: rates[0], repMax: rates[1],
        max: Number(m[6]), initial: Number(m[7]),
        religions, events,
      });
    }
  }
  return entries;
}

const bnameCache = {};
function buildingDisplayName(bnames, level, culture, owner) {
  const lk = level.toLowerCase();
  const cacheKey = `${lk}|${culture}|${owner}`;
  if (bnameCache[cacheKey]) return bnameCache[cacheKey];
  // A real display name; raw key-like values ("isengard_barracks_lvl3") are
  // placeholders, not names.
  const ok = (v) => v && !/^[a-z0-9_]+$/.test(v.trim()) && !/do not translate/i.test(v) && !/^\{/.test(v);
  // Some text tags drop the level key's first token (tower_ecthelion -> {ecthelion_*});
  // suffixes may be a faction tag (_france) or a culture (_northern_european).
  const candidates = [lk];
  if (lk.includes('_')) candidates.push(lk.split('_').slice(1).join('_'));
  let name = null;
  outer:
  for (const cand of candidates) {
    for (const suffix of [owner, culture]) {
      if (!suffix) continue;
      const v = bnames[`${cand}_${suffix}`.toLowerCase()];
      if (ok(v)) { name = v; break outer; }
    }
    if (ok(bnames[cand])) { name = bnames[cand]; break; }
    // any suffix variant the mod defines (skip _desc/_desc_short entries)
    const prefix = `${cand}_`;
    for (const key of Object.keys(bnames)) {
      if (key.startsWith(prefix) && !key.includes('desc') && ok(bnames[key])) { name = bnames[key]; break outer; }
    }
  }
  if (!name) name = level.replace(/_lvl\d+$/i, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  bnameCache[cacheKey] = name;
  return name;
}

// Building description: tags are {level}_desc or {level}_<culture/faction>_desc
// (the suffix sits before _desc), optionally with the level's first token
// dropped, mirroring the name-tag conventions.
function buildingDesc(bnames, level, culture, owner) {
  const ok = (v) => v && v.length > 40 && !/do not translate/i.test(v) && !/^\{/.test(v);
  const lk = level.toLowerCase();
  const candidates = [lk];
  if (lk.includes('_')) candidates.push(lk.split('_').slice(1).join('_'));
  for (const cand of candidates) {
    for (const suffix of [owner, culture]) {
      if (suffix && ok(bnames[`${cand}_${suffix}_desc`.toLowerCase()])) return bnames[`${cand}_${suffix}_desc`.toLowerCase()];
    }
    if (ok(bnames[`${cand}_desc`])) return bnames[`${cand}_desc`];
    for (const key of Object.keys(bnames)) {
      if (key.startsWith(cand + '_') && key.endsWith('_desc') && ok(bnames[key])) return bnames[key];
    }
  }
  return '';
}

// Building pictures live per culture: data/ui/<culture>/buildings/#<culture>_<level>.tga
function buildBuildingPicIndex() {
  const index = {}; // level -> { culture -> tga path }
  const uiDir = path.join(MOD_ROOT, 'data', 'ui');
  if (!fs.existsSync(uiDir)) return index;
  for (const culture of fs.readdirSync(uiDir)) {
    const dir = path.join(uiDir, culture, 'buildings');
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(new RegExp(`^#${culture}_(.+)\\.tga$`, 'i'));
      if (!m || /_constructed$/i.test(m[1])) continue;
      const level = m[1].toLowerCase();
      (index[level] = index[level] || {})[culture.toLowerCase()] = path.join(dir, f);
    }
  }
  return index;
}

const ECON_KEYS = new Set(['trade_base_income_bonus', 'taxable_income_bonus', 'income_bonus',
  'mine_resource', 'farming_level', 'road_level', 'trade_fleet',
  'construction_cost_bonus_wooden', 'construction_cost_bonus_stone']);

// Regional = chains locked to a rare hidden resource (Meduseld, the Tower of
// Ecthelion, the Mûmakil network…). Broadly shared hidden resources
// (culture/area gating) don't count.
const CIVIC_KEYS = new Set(['religion_level', 'amplify_religion_level', 'law_bonus',
  'happiness_bonus', 'population_growth_bonus', 'population_health_bonus',
  'population_loyalty_bonus']);
function chainCategory(chain, rareHr) {
  if (chain.name.toLowerCase().includes('guild')) return 'Guilds';
  const ls = chain.levels;
  if (!ls.length) return 'Other';
  if (ls.every((l) => l.hr.some((h) => rareHr.has(h)))) return 'Regional';
  if (ls.some((l) => l.effects.some((e) => ['wall_level', 'tower_level', 'gate_strength', 'gate_defences'].includes(e.key)))) return 'Defence';
  if (ls.some((l) => l.recruits.length)) return 'Military';
  if (ls.some((l) => l.effects.some((e) => ECON_KEYS.has(e.key)))) return 'Economy';
  if (ls.some((l) => l.effects.some((e) => CIVIC_KEYS.has(e.key)))) return 'Civic';
  return 'Other';
}

// Many EDB effect lines repeat per faction with the same or near-same value
// ("law_bonus 2 requires factions { saxons }" × 10). Group by key: plain
// factions-only variants collapse into one value or a range; event/region
// conditions keep a * marker with the requirement in a tooltip.
function effectText(key, vals) {
  const label = EFFECT_LABELS[key];
  const lo = vals[0];
  const hi = vals[vals.length - 1];
  if (FLAG_KEYS.has(key)) return label;
  if (LEVEL_KEYS.has(key)) return label + ' level ' + (lo === hi ? lo : lo + '–' + hi);
  if (PCT_KEYS.has(key)) return label + ' −' + (lo === hi ? lo : lo + '–' + hi) + '%';
  if (lo < 0 && hi > 0) return label + ' ' + lo + '–+' + hi;
  if (hi <= 0) return label + ' −' + (lo === hi ? -hi : -hi + '–' + -lo);
  return label + ' +' + (lo === hi ? hi : lo + '–' + hi);
}

function renderEffectGroups(groups) {
  return groups.map((g) => {
    const vals = [...new Set(g.vals)].sort((a, b) => a - b);
    const txt = effectText(g.key, vals);
    if (g.cond) {
      const safe = g.cond.replace(/"/g, '&quot;').replace(/</g, '&lt;');
      return `<span class="cond" title="requires: ${safe}">${txt}*</span>`;
    }
    return txt;
  });
}

function aggregateEffects(effects) {
  const byKey = new Map();
  for (const e of effects) {
    const conditional = /event_counter|hidden_resource/.test(e.cond);
    const k = e.key + (conditional ? '|' + e.cond : '');
    if (!byKey.has(k)) byKey.set(k, { key: e.key, vals: [], cond: conditional ? e.cond : '' });
    byKey.get(k).vals.push(e.val);
  }
  return renderEffectGroups([...byKey.values()]);
}

const effectFacs = (cond) => ((cond.match(/factions\s*\{([^}]*)\}/) || [])[1] || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Resolve the effect list from one faction's point of view: variants gated to
// other factions drop out, and the factions clause itself disappears from the
// condition tooltip (only the real event/region requirement remains). Where a
// faction has several unconditional values for a key, the highest applies.
// EDB factions clauses sometimes name a culture instead of a faction tag, so
// the faction's culture also counts as a match.
function effectsForFaction(effects, facTag, culture) {
  const byKey = new Map();
  for (const e of effects) {
    const facs = effectFacs(e.cond);
    if (facs.length && !facs.includes(facTag) && !(culture && facs.includes(culture))) continue;
    let cond = e.cond.replace(/factions\s*\{[^}]*\}\s*(and\s+)?/, '').trim();
    if (!/event_counter|hidden_resource/.test(cond)) cond = '';
    const k = e.key + (cond ? '|' + cond : '');
    if (!byKey.has(k)) byKey.set(k, { key: e.key, vals: [], cond });
    byKey.get(k).vals.push(e.val);
  }
  return renderEffectGroups([...byKey.values()].map((g) => (
    g.cond ? g : { ...g, vals: [Math.max(...g.vals)] }
  )));
}

// Chain slugs must be reproducible from both pages (unit-page links point at
// buildings.html#<slug>), so no dedupe counter — chain names are unique.
const chainSlug = (n) => n.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Assembles the buildings-page model from the parsed EDB chains.
// Default pictures (no faction selected) come from one culture's series per
// chain, preferring the human and elven art sets; without this the pick falls
// to whichever culture folder sorts first (eastern_european — the orc set),
// and tiers of one chain can even mix series.
const PIC_PREF = ['gondor', 'greek', 'northern_european', 'mesoamerican',
  'southern_european', 'middle_eastern', 'eastern_european'];

function buildBuildings(chains, bnames, ownerMap, cultures, guilds, unitsByType, picIndex) {
  const triggers = parseGuildTriggers();
  const facNames = (facs) => [...new Set(facs.map((f) => ownerMap[f]).filter(Boolean))];
  // hidden resources used by at most 2 chains are unique-landmark locks
  const hrChains = new Map();
  for (const chain of chains) {
    for (const l of chain.levels) {
      for (const h of l.hr) (hrChains.get(h) || hrChains.set(h, new Set()).get(h)).add(chain.name);
    }
  }
  const rareHr = new Set([...hrChains].filter(([, set]) => set.size <= 2).map(([h]) => h));
  const out = [];
  for (const chain of chains) {
    if (!chain.levels.length) continue;
    // script-marker chains (quest flags etc.): nothing buildable or shown
    if (chain.levels.every((l) => !l.cost && !l.effects.length && !l.recruits.length)) continue;
    // owner faction tag for name/desc/picture resolution: only when the whole
    // chain is restricted to a single mappable faction
    const tagSets = chain.levels.map((l) => l.facs.filter((f) => ownerMap[f]));
    const uniqueTags = [...new Set(tagSets.flat())];
    const owner = uniqueTags.length === 1 ? uniqueTags[0] : '';
    const culture = (owner && cultures[owner]) || '';
    const guild = guilds[chain.name];
    const allTags = Object.keys(ownerMap);
    // one picture series for the whole chain: the owner's culture, else the
    // preferred culture covering the most levels
    let picCulture = culture;
    if (!picCulture) {
      const counts = new Map();
      for (const l of chain.levels) {
        for (const c of Object.keys(picIndex[l.level.toLowerCase()] || {})) {
          counts.set(c, (counts.get(c) || 0) + 1);
        }
      }
      let bestScore = -1;
      for (let i = 0; i < PIC_PREF.length; i++) {
        const n = counts.get(PIC_PREF[i]) || 0;
        const score = n * 100 + (PIC_PREF.length - i);
        if (n && score > bestScore) { bestScore = score; picCulture = PIC_PREF[i]; }
      }
    }
    const levels = chain.levels.map((l) => {
      const picByCulture = picIndex[l.level.toLowerCase()] || {};
      const tgaCulture = picByCulture[picCulture] ? picCulture
        : PIC_PREF.find((c) => picByCulture[c]) || Object.keys(picByCulture)[0] || '';
      const tga = tgaCulture ? picByCulture[tgaCulture] : '';
      const defName = buildingDisplayName(bnames, l.level, culture, owner);
      const defPic = tga ? exportImage(tga, `${l.level}_${tgaCulture}`, OUT_BPICS, 'buildingpics') : '';
      // Shared chains carry per-culture names and pictures (Isengard's version
      // of a chain isn't called what Gondor's is); store only the variants
      // that differ from the default, keyed by faction display name.
      const names = {};
      const pics = {};
      const candTags = l.facs.filter((t) => ownerMap[t]);
      for (const t of (candTags.length ? candTags : allTags)) {
        const c = cultures[t] || '';
        const disp = ownerMap[t];
        const vName = buildingDisplayName(bnames, l.level, c, t);
        if (vName !== defName) names[disp] = vName;
        const vTga = picByCulture[c];
        if (vTga && vTga !== tga) {
          const vPic = exportImage(vTga, `${l.level}_${c}`, OUT_BPICS, 'buildingpics');
          if (vPic && vPic !== defPic) pics[disp] = vPic;
        }
      }
      // merge recruit pools by unit, tracking which factions get it
      // (f = null means every owner of the building can recruit it)
      const rec = new Map();
      for (const r of l.recruits) {
        const u = unitsByType[r.unit.trim().toLowerCase()];
        const key = u ? u.name : r.unit;
        const rf = r.facs.map((t) => ownerMap[t]).filter(Boolean);
        const e = rec.get(key);
        if (!e) rec.set(key, { n: key, s: u ? u.slug : '', exp: r.exp, f: r.facs.length ? new Set(rf) : null });
        else if (e.f) {
          if (!r.facs.length) e.f = null;
          else for (const f of rf) e.f.add(f);
        }
      }
      // per-faction resolved effects (armour tiers, law, …), stored only where
      // they differ from the merged all-factions view
      const ffx = {};
      if (l.effects.some((e) => /factions\s*\{/.test(e.cond))) {
        const def = aggregateEffects(l.effects).join('');
        for (const t of (candTags.length ? candTags : allTags)) {
          const fx = effectsForFaction(l.effects, t, cultures[t]);
          if (fx.join('') !== def) ffx[ownerMap[t]] = fx;
        }
      }
      return {
        name: defName, names, pics, ffx,
        kind: l.kind, tier: l.tier, of: l.of,
        cost: l.cost, time: l.time,
        min: l.min.replace(/_/g, ' '),
        hr: l.hr.filter((h) => h !== 'unlocked').map((h) => h.replace(/_/g, ' ')), // 'unlocked' is a script flag, not a region
        ev: l.ev.map((e) => e.replace(/_/g, ' ')),
        facs: facNames(l.facs),
        effects: aggregateEffects(l.effects),
        recruits: [...rec.values()].map((r) => ({ ...r, f: r.f ? [...r.f].sort() : [] })),
        points: guild ? guild.points[l.tier - 1] : null,
        pic: defPic,
      };
    });
    const first = levels[0];
    // placeholder "names" (script-quest helpers like green_book_*) keep their
    // raw underscores — real localized names never do
    if (/_/.test(first.name)) continue;
    out.push({
      slug: chainSlug(chain.name),
      chain: chain.name,
      name: first.name,
      cat: chainCategory(chain, rareHr),
      tiers: levels.length,
      facs: [...new Set(levels.flatMap((l) => l.facs))],
      desc: cleanText(buildingDesc(bnames, chain.levels[0].level, culture, owner)),
      guild: guild ? guild.name.replace(/_/g, ' ') : '',
      gname: (triggers[chain.name] || {}).gname || '',
      how: (triggers[chain.name] || {}).how || [],
      gfacs: facNames((triggers[chain.name] || {}).facTags || []),
      pic: first.pic,
      levels,
    });
  }
  return out;
}

// --------------------------------------------------------------- EOP units
// M2TWEOP (eopData/eopScripts) injects extra units at runtime. Active entries
// in Units/EOPDU.lua either point at an EDU-format file under
// Resources/Unit_Types (new units, parsed here) or clone an existing unit via
// rootUnit (stat-identical bodyguard copies, skipped to avoid duplicate rows).

function parseEopUnits() {
  const luaFile = path.join(EOP_SCRIPTS, 'Units', 'EOPDU.lua');
  if (!fs.existsSync(luaFile)) return [];
  const lua = fs.readFileSync(luaFile, 'utf8');
  const out = [];
  for (const m of lua.matchAll(/^[ \t]{8}(\w+) = eopUnit:new \{([\s\S]*?)^[ \t]{8}\}/gm)) {
    const body = m[2];
    const filePath = (body.match(/filePath\s*=\s*"([^"]*)"/) || [])[1];
    if (!filePath) continue;
    const file = path.join(EOP_SCRIPTS, 'Resources', filePath.replace(/^\//, ''));
    if (!fs.existsSync(file)) continue;
    const parsed = parseEduText(fs.readFileSync(file, 'latin1'), 'EOP Additions');
    if (!parsed.length) continue;
    const u = parsed[0];
    u.eop = true;
    if (/freeUpkeep\s*=\s*true/.test(body) && !u.attributes.includes('free_upkeep_unit')) {
      u.attributes.push('free_upkeep_unit');
    }
    out.push(u);
  }
  return out;
}

// Main-EDU units reveal which vanilla ownership tag each faction uses
// (e.g. sicily -> Gondor); EOP units are slotted into factions through it.
function buildOwnerMap(edu) {
  const tally = {};
  for (const u of edu) {
    const owner = [u.era0, ...(u.ownership || [])].find((o) => o && o !== 'slave');
    if (!owner) continue;
    (tally[owner] = tally[owner] || {})[u.section] = (tally[owner][u.section] || 0) + 1;
  }
  const map = {};
  for (const [o, secs] of Object.entries(tally)) {
    map[o] = Object.entries(secs).sort((a, b) => b[1] - a[1])[0][0];
  }
  return map;
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
  const eop = parseEopUnits();
  const ownerMap = buildOwnerMap(edu);
  for (const u of eop) {
    const owner = [u.era0, ...(u.ownership || [])].find((o) => o && o !== 'slave' && ownerMap[o]);
    u.section = owner ? ownerMap[owner] : 'EOP Additions';
  }
  const cardIndex = buildCardIndex();
  const portraitIndex = buildPortraitIndex();
  const { byUnit: edb, chains: edbChains } = parseEdb(EDB_TXT);
  const bnames = parseExportUnits(BUILDINGS_TXT); // same {tag}text format
  const facInfo = parseFactionCultures(SM_FACTIONS_TXT);
  const cultures = facInfo.culture;
  const mercAll = parseMercs(MERC_TXT, new Set(Object.values(facInfo.religion)));

  // religion tag -> faction display names able to hire that mercenary
  const relFactions = {};
  for (const [tag, rel] of Object.entries(facInfo.religion)) {
    const disp = ownerMap[tag];
    if (!disp) continue;
    (relFactions[rel] = relFactions[rel] || new Set()).add(disp);
  }
  const allHirers = new Set();
  for (const s of Object.values(relFactions)) for (const f of s) allHirers.add(f);
  const hirersLabel = (religions) => {
    if (!religions.length) return '';
    const set = new Set();
    for (const r of religions) for (const f of relFactions[r] || []) set.add(f);
    if (!set.size) return '';
    const missing = [...allHirers].filter((f) => !set.has(f)).sort();
    if (!missing.length) return 'all factions';
    if (missing.length <= 3) return 'all except ' + missing.join(', ');
    return [...set].sort().join(', ');
  };
  // e.g. turks_allied_normans -> the two factions behind the vanilla tags
  const prettyEvent = (e) => {
    const m = e.match(/^([a-z]+)_allied_([a-z]+)$/);
    if (m && ownerMap[m[1]] && ownerMap[m[2]]) return 'alliance: ' + ownerMap[m[1]] + ' & ' + ownerMap[m[2]];
    return e.replace(/_/g, ' ');
  };

  // Stable per-unit slug for #deep-links, derived from the (unique) EDU type.
  const slugSeen = new Set();
  const slugify = (t) => {
    const base = t.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    let s = base;
    let n = 2;
    while (slugSeen.has(s)) s = base + '-' + n++;
    slugSeen.add(s);
    return s;
  };

  const units = [];
  const unitsByType = {}; // EDU type -> { name, slug }, for buildings-page links
  let missingNames = 0;
  let missingCards = 0;
  let missingPortraits = 0;
  let recruitable = 0;
  let mercCount = 0;

  for (const u of [...edu, ...eop]) {
    const dict = (u.dict || u.type).trim();
    const key = dict.toLowerCase();
    const name = names[key] || u.type;
    if (!names[key]) missingNames += 1;
    const card = cardIndex[key] ? exportCard(cardIndex[key], dict) : '';
    if (!card) missingCards += 1;
    const pic = portraitIndex[key] ? exportPortrait(portraitIndex[key], dict) : '';
    if (!pic) missingPortraits += 1;

    // Recruitment: EDB entries are keyed by the EDU type string. Prefer the
    // pools of the unit's own faction tag; merge duplicate building/rate rows
    // that only differ by region or event conditions.
    const owner = [u.era0, ...(u.ownership || [])].find((o) => o && o !== 'slave');
    const culture = (owner && cultures[owner]) || '';
    let pools = edb[u.type.trim().toLowerCase()] || [];
    if (owner) {
      const own = pools.filter((p) => p.facs.includes(owner));
      if (own.length) pools = own;
    }
    const merged = new Map();
    for (const p of pools) {
      const k = `${p.level}|${p.rate}|${p.max}|${p.exp}`;
      if (!merged.has(k)) {
        merged.set(k, {
          b: buildingDisplayName(bnames, p.level, culture, owner),
          c: chainSlug(p.chain),
          tier: p.tier, of: p.of, kind: p.kind,
          rate: p.rate, max: p.max, exp: p.exp,
          hr: new Set(p.hr), ev: new Set(p.ev), variants: 1,
        });
      } else {
        const e = merged.get(k);
        for (const h of p.hr) e.hr.add(h);
        for (const x of p.ev) e.ev.add(x);
        e.variants += 1;
      }
    }
    const recruit = [...merged.values()]
      .sort((a, b) => a.tier - b.tier || b.rate - a.rate)
      .map((e) => ({ ...e, max: Math.round(e.max * 10) / 10, hr: [...e.hr].slice(0, 4), ev: [...e.ev].slice(0, 2) }));
    if (recruit.length) recruitable += 1;

    // Mercenary pools: merge entries with identical terms, union their regions.
    const mPools = mercAll[u.type.trim().toLowerCase()] || [];
    const mMerged = new Map();
    for (const p of mPools) {
      const k = [p.cost, p.repMin, p.repMax, p.max, p.initial, p.exp, p.religions.join(','), p.events.join(',')].join('|');
      if (!mMerged.has(k)) mMerged.set(k, { ...p, regions: new Set(p.regions) });
      else for (const r of p.regions) mMerged.get(k).regions.add(r);
    }
    const merc = [...mMerged.values()]
      .sort((a, b) => a.cost - b.cost)
      .map((e) => ({
        cost: e.cost, exp: e.exp, max: e.max, initial: e.initial,
        tMin: e.repMax > 0 ? Math.max(1, Math.round(1 / e.repMax)) : 0,
        tMax: e.repMin > 0 ? Math.round(1 / e.repMin) : 0,
        regions: [...e.regions].map((r) => r.replace(/_Province$/i, '').replace(/_/g, ' ')).sort(),
        hirers: hirersLabel(e.religions),
        ev: e.events.map(prettyEvent),
      }));
    if (merc.length) mercCount += 1;

    // melee weapon = whichever of pri/sec is a melee strike; missile likewise
    let melee = null;
    let missile = null;
    let meleeAttr = [];
    let missileAttr = [];
    if (u.pri && u.pri.type === 'melee') { melee = u.pri; meleeAttr = u.priAttr || []; }
    if (!melee && u.sec && u.sec.type === 'melee') { melee = u.sec; meleeAttr = u.secAttr || []; }
    if (isMissileWeapon(u.pri)) { missile = u.pri; missileAttr = u.priAttr || []; }
    else if (isMissileWeapon(u.sec)) { missile = u.sec; missileAttr = u.secAttr || []; }

    const slug = slugify(u.type);
    unitsByType[u.type.trim().toLowerCase()] = { name, slug };
    units.push({
      name,
      slug,
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
      moveSpeed: u.moveSpeed || 0,
      armourUg: u.armourUg || [],
      recruit,
      merc,
      eop: !!u.eop,
      card,
      pic,
      attributes: u.attributes || [],
      descr: cleanText(names[`${key}_descr`] || ''),
      short: cleanText(names[`${key}_descr_short`] || ''),
    });
  }

  // EOP units join the end of their faction's group (stable sort by the
  // factions' first appearance keeps the original order otherwise).
  const order = [...new Set(units.map((x) => x.faction))];
  units.sort((a, b) => order.indexOf(a.faction) - order.indexOf(b.faction));

  // Reference data, trimmed to entries actually used by a unit.
  const projAll = parseProjectiles(PROJ_TXT);
  const mountAll = parseMounts(MOUNT_TXT);
  const projectiles = {};
  const mounts = {};
  for (const u of units) {
    if (u.mslName) {
      const k = u.mslName.toLowerCase();
      if (projAll[k]) projectiles[k] = projAll[k];
    }
    if (u.mount) {
      const k = u.mount.toLowerCase();
      if (mountAll[k]) mounts[k] = mountAll[k];
    }
  }

  const factions = [...new Set(units.map((x) => x.faction))];

  // Buildings & Guilds page model
  const guilds = parseGuilds(GUILDS_TXT);
  const buildings = buildBuildings(
    edbChains, bnames, ownerMap, cultures, guilds, unitsByType, buildBuildingPicIndex());

  // unit-page building links must only target chains the buildings page shows
  const published = new Set(buildings.map((b) => b.slug));
  for (const u of units) {
    for (const r of u.recruit) if (!published.has(r.c)) r.c = '';
  }

  const factionPages = buildFactionsModel(units, ownerMap, unitsByType, edbChains, buildings, guilds, cultures);

  return {
    units, factions, projectiles, mounts, buildings, factionPages,
    missingNames, missingCards, missingPortraits, eopCount: eop.length, recruitable, mercCount,
  };
}

// --------------------------------------------------------------------- html

function buildHtml(model) {
  const dataJson = JSON.stringify(model.units);
  const factionsJson = JSON.stringify(model.factions);
  const projJson = JSON.stringify(model.projectiles);
  const mountJson = JSON.stringify(model.mounts);
  const generated = new Date().toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AGO — Unit Compendium</title>
<link href="fonts/fonts.css" rel="stylesheet">
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
.sitenav {
  margin: 10px 0 0;
  font-family: var(--display);
  font-size: 12.5px;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.sitenav a {
  color: var(--ink-soft);
  text-decoration: none;
  padding: 2px 10px;
  border-bottom: 2px solid transparent;
}
.sitenav a.active { color: var(--accent); border-bottom-color: var(--accent); }
.sitenav a:hover { color: var(--accent); }
a.bldlink { color: inherit; text-decoration: none; border-bottom: 1px dotted var(--line-dark); }
a.bldlink:hover { color: var(--accent); }
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
  top: var(--ctrlh, 49px);
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
.badge.eop { border-color: var(--accent); color: var(--accent); }
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
a.ref {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px dotted var(--accent);
  cursor: pointer;
}
a.ref:hover { background: rgba(122,31,31,.08); }
#ref-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(43,33,24,.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
#ref-modal[hidden] { display: none; }
.ref-box {
  background: var(--parchment);
  border: 2px solid var(--line-dark);
  border-radius: 4px;
  box-shadow: 0 8px 30px rgba(30,20,5,.5);
  max-width: 460px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  padding: 18px 22px 20px;
}
.ref-box h2 {
  font-family: var(--display);
  font-size: 19px;
  letter-spacing: .08em;
  color: var(--accent);
  margin: 0 0 2px;
  border-bottom: 2px double var(--line-dark);
  padding-bottom: 6px;
}
.ref-box .ref-kind {
  font-family: var(--display);
  font-size: 11px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--ink-soft);
}
.ref-box table { border-collapse: collapse; width: 100%; margin: 10px 0 4px; }
.ref-box table td { border: none; border-bottom: 1px dotted var(--line); padding: 3px 8px 3px 0; font-size: 14.5px; }
.ref-box table td:first-child {
  font-family: var(--display);
  font-size: 10.5px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--ink-soft);
  width: 130px;
}
.ref-box .ref-note { font-style: italic; color: var(--ink-soft); font-size: 13.5px; margin: 8px 0 0; }
.ref-box .ref-users { margin: 10px 0 0; }
.ref-box .ref-users h3 {
  font-family: var(--display);
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin: 0 0 4px;
}
.ref-box .ref-users a {
  display: inline-block;
  color: var(--ink);
  text-decoration: none;
  border-bottom: 1px dotted var(--line-dark);
  margin: 0 10px 3px 0;
  font-size: 14.5px;
  cursor: pointer;
}
.ref-box .ref-users a:hover { color: var(--accent); }
.ref-box .ref-close {
  float: right;
  font-family: var(--display);
  font-size: 13px;
  border: 1px solid var(--line-dark);
  border-radius: 3px;
  background: var(--parchment-dark);
  color: var(--ink-soft);
  padding: 1px 8px;
  cursor: pointer;
  margin-left: 10px;
}
#cmp-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 50;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  background: var(--parchment-dark);
  border-top: 2px solid var(--line-dark);
  box-shadow: 0 -2px 8px rgba(60,40,10,.25);
  font-size: 14.5px;
}
#cmp-bar .cmp-label {
  font-family: var(--display);
  font-size: 11.5px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ink-soft);
}
#cmp-bar .pin {
  border: 1px solid var(--line-dark);
  border-radius: 3px;
  background: #fbf6e7;
  padding: 2px 8px;
  margin-right: 6px;
}
#cmp-bar .pin a { cursor: pointer; color: var(--accent); margin-left: 6px; text-decoration: none; font-weight: 700; }
#cmp-bar button {
  font-family: var(--display);
  font-size: 12.5px;
  letter-spacing: .05em;
  border: 1px solid var(--line-dark);
  border-radius: 3px;
  background: var(--accent);
  color: #f6eeda;
  padding: 3px 12px;
  cursor: pointer;
}
#cmp-bar button:disabled { opacity: .45; cursor: default; }
#cmp-bar #cmp-clear { background: var(--parchment); color: var(--ink-soft); }
.ref-box.wide { max-width: 920px; }
.ref-box table th {
  font-family: var(--serif);
  font-size: 14.5px;
  font-weight: 600;
  text-align: left;
  padding: 3px 8px 5px 0;
  border-bottom: 2px solid var(--line-dark);
  vertical-align: bottom;
}
.ref-box table th img {
  display: block;
  width: 36px;
  border: 1px solid var(--line-dark);
  border-radius: 2px;
  margin-bottom: 3px;
  background: #2e2418;
}
.ref-box table th a { color: var(--ink); text-decoration: none; border-bottom: 1px dotted var(--line-dark); cursor: pointer; }
.ref-box table th a:hover { color: var(--accent); }
.ref-box td.best { color: var(--good); font-weight: 700; }
tr.unit.flash { animation: rowflash 1.6s ease-out; }
@keyframes rowflash { 0% { background: #d8b86a; } 100% { background: var(--row-alt); } }
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
@media (max-width: 620px) {
  .hide-xs { display: none; }
  body { font-size: 14px; }
  tbody td { padding: 2px 4px; font-size: 13.5px; }
  td.name { font-size: 14px; white-space: normal; }
  td.name .cls { display: none; }
  thead th { padding: 5px 4px; font-size: 10.5px; }
  .controls { gap: 6px 8px; padding: 8px 8px; }
  .controls input[type=search] { width: 130px; }
  main { padding: 8px 4px 60px; }
  header h1 { font-size: 24px; }
  .detail-stats td:first-child { width: 90px; }
}
</style>
</head>
<body>
<header>
  <h1>AGO &mdash; Unit Compendium</h1>
  <p class="sub">A field guide to every host of Middle-earth &middot; Medieval II: Total War</p>
  <nav class="sitenav"><a href="index.html" class="active">Units</a><a href="factions.html">Factions</a><a href="buildings.html">Buildings &amp; Guilds</a></nav>
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
        <th data-k="morale" class="num hide-xs">Mor <span class="arrow"></span></th>
        <th data-k="hp" class="num hide-sm">HP <span class="arrow"></span></th>
        <th data-k="cost" class="num">Cost <span class="arrow"></span></th>
        <th data-k="upkeep" class="num hide-xs">Upkeep <span class="arrow"></span></th>
        <th data-k="turns" class="num hide-sm">Turns <span class="arrow"></span></th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="empty" id="empty" hidden>No units match these filters.</div>
</main>

<div id="ref-modal" hidden><div class="ref-box" role="dialog"></div></div>

<div id="cmp-bar" hidden>
  <span class="cmp-label">Compare</span>
  <span id="cmp-items"></span>
  <button id="cmp-go">Compare</button>
  <button id="cmp-clear">Clear</button>
</div>

<footer>Soldier counts shown at Huge unit size (game scales data values &times;2.5) &middot; Generated ${generated} from <code>export_descr_unit.txt</code> &amp; <code>export_units.txt</code> &middot; ${model.units.length} units &middot; rebuild with <code>node build.js</code></footer>

<script>
const UNITS = ${dataJson};
const FACTIONS = ${factionsJson};
const PROJ = ${projJson};
const MOUNTS = ${mountJson};
// In-game soldier counts are the data-file numbers scaled by the unit-size
// setting; this site shows Huge (x2.5), the scale the mod is balanced around.
const SIZE_SCALE = 2.5;
const inGame = (n) => Math.round(n * SIZE_SCALE);
UNITS.forEach((u, i) => { u.id = i; u.def = u.armour + u.skill + u.shield; });

const state = { q: '', faction: '', cat: '', sortKey: null, sortDir: 1, open: new Set() };

// ?faction=<name> pre-selects the faction filter (used by the factions page)
const qpFaction = new URLSearchParams(location.search).get('faction');
if (qpFaction && FACTIONS.includes(qpFaction)) state.faction = qpFaction;

// Keep the sticky column header just below the (wrapping) control bar.
const setCtrlH = () => document.documentElement.style.setProperty('--ctrlh',
  document.querySelector('.controls').offsetHeight + 'px');
window.addEventListener('resize', setCtrlH);
setCtrlH();

const $faction = document.getElementById('faction');
for (const f of FACTIONS) {
  const n = UNITS.filter(u => u.faction === f).length;
  const o = document.createElement('option');
  o.value = f;
  o.textContent = f + ' (' + n + ')';
  $faction.appendChild(o);
}
if (state.faction) $faction.value = state.faction;

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
    '<td class="name">' + card + esc(u.name) +
      (u.eop ? '<span class="badge eop" title="Added at runtime by the M2TWEOP engine overhaul">EOP</span>' : '') +
      ' <span class="cls">' + typeLabel(u) + '</span></td>' +
    '<td class="num">' + men + '</td>' +
    '<td class="num">' + fmt(u.atk) + badges(u.meleeAttr) + '</td>' +
    '<td class="num hide-sm">' + fmt(u.chg) + '</td>' +
    '<td class="num">' + fmt(u.msl) + (u.msl !== null ? badges(u.mslAttr) : '') + '</td>' +
    '<td class="num hide-sm">' + fmt(u.rng) + '</td>' +
    '<td class="num hide-sm">' + fmt(u.ammo) + '</td>' +
    '<td class="num">' + def + '</td>' +
    '<td class="num hide-xs">' + mor + '</td>' +
    '<td class="num hide-sm">' + hp + '</td>' +
    '<td class="num">' + u.cost + '</td>' +
    '<td class="num hide-xs">' + u.upkeep + '</td>' +
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
  if (u.msl !== null) {
    const pk = u.mslName ? u.mslName.toLowerCase() : '';
    const ammoLink = PROJ[pk]
      ? ' · <a class="ref" data-ref="proj:' + pk + '">' + esc(u.mslName) + '</a>'
      : (u.mslName ? ' · ' + esc(u.mslName) : '');
    add('Ranged', 'attack ' + u.msl + ', range ' + u.rng + ', ' + u.ammo + ' ammo' + (u.mslAttr.length ? ' · ' + u.mslAttr.join(', ') : '') + ammoLink);
  }
  add('Defence', u.def + ' = armour ' + u.armour + ' + skill ' + u.skill + ' + shield ' + u.shield + (u.armourMat ? ' (' + u.armourMat + ')' : ''));
  add('Morale', u.morale + (u.lockMorale ? ' (locked — never routs)' : '') + ' · ' + u.discipline + ' · ' + u.training.replace(/_/g, ' '));
  if (u.vsMounts) add('Vs mounts', esc(u.vsMounts));
  if (u.formations.length) add('Formations', u.formations.map(f => f.replace(/_/g, ' ')).join(', '));
  if (u.moveSpeed && u.moveSpeed !== 1) add('Move speed', '\\u00D7' + u.moveSpeed);
  if (u.mount) {
    const mk = u.mount.toLowerCase();
    add('Mount', MOUNTS[mk] ? '<a class="ref" data-ref="mount:' + mk + '">' + esc(u.mount) + '</a>' : esc(u.mount));
  }
  if (u.armourUg.length > 1) {
    add('Armour upgrades', '<a class="ref" data-ref="armour:' + u.id + '">' + u.armourUg.join(' \\u2192 ') + '</a> (' + (u.armourUg.length - 1) + ')');
  }
  if (u.engine) add('Engine', esc(u.engine.replace(/_/g, ' ')));
  add('Recruitment', u.cost + ' gold · ' + u.upkeep + ' upkeep · ' + u.turns + (u.turns === 1 ? ' turn' : ' turns') + ' to train');
  if (u.recruit.length) {
    const lines = u.recruit.map(r => {
      const every = r.rate > 0 ? '+1 every ~' + Math.max(1, Math.round(1 / r.rate)) + ' turns' : 'no replenishment';
      const conds = [];
      if (r.hr.length) conds.push('region: ' + r.hr.join(', ').replace(/_/g, ' '));
      if (r.ev.length) conds.push('event: ' + r.ev.join(', ').replace(/_/g, ' '));
      const bname = r.c
        ? '<a class="bldlink" href="buildings.html#' + r.c + '"><b>' + esc(r.b) + '</b></a>'
        : '<b>' + esc(r.b) + '</b>';
      return bname + ' <span class="dim">(' + (r.kind ? r.kind + ', ' : '') + 'tier ' + r.tier + '/' + r.of + ')</span> — ' +
        every + ', pool ' + r.max + (r.exp ? ', +' + r.exp + ' exp' : '') +
        (conds.length ? ' <span class="dim">· ' + esc(conds.join(' · ')) + '</span>' : '');
    });
    add('Buildings', lines.join('<br>'));
  }
  if (u.merc.length) {
    const lines = u.merc.map(r => {
      const every = r.tMax
        ? '+1 every ~' + (r.tMin === r.tMax ? r.tMin : r.tMin + '\\u2013' + r.tMax) + ' turns'
        : 'no replenishment';
      const SHOW = 8;
      const regs = r.regions.length > SHOW
        ? '<span title="' + esc(r.regions.join(', ')) + '">' + esc(r.regions.slice(0, SHOW).join(', ')) + ' +' + (r.regions.length - SHOW) + ' more</span>'
        : esc(r.regions.join(', '));
      const conds = [];
      if (r.hirers) conds.push('for: ' + esc(r.hirers));
      if (r.ev.length) conds.push('event: ' + esc(r.ev.join(', ')));
      return '<b>' + r.cost + ' gold</b> — ' + every + ', pool ' + r.max + (r.initial ? ' (starts at ' + r.initial + ')' : '') +
        (r.exp ? ', +' + r.exp + ' exp' : '') +
        '<br><span class="dim">in: ' + regs + (conds.length ? ' · ' + conds.join(' · ') : '') + '</span>';
    });
    add('Mercenary hire', lines.join('<br>'));
  }
  if (!u.recruit.length && !u.merc.length) {
    const why = u.eop ? 'No building pool — granted by campaign scripts (M2TWEOP).'
      : u.attributes.includes('general_unit') ? 'Bodyguard — arrives with new generals and family members, not recruited.'
      : 'Not recruited from buildings — granted by events or campaign scripts.';
    add('Availability', '<span class="dim">' + why + '</span>');
  }
  if (u.heat) add('Heat fatigue', '-' + u.heat);
  if (u.ground.length === 4) {
    const g = u.ground.map((v, i) => v ? ['scrub', 'sand', 'forest', 'snow'][i] + ' ' + (v > 0 ? '+' : '') + v : '').filter(Boolean).join(', ');
    if (g) add('Terrain', g);
  }
  if (notes.length) add('Traits', notes.join(', '));
  if (u.eop) add('Source', 'Added at runtime by M2TWEOP (eopData/eopScripts)');
  add('Link', '<a class="ref" data-copy="' + u.slug + '" title="Copy a direct link to this unit">copy link</a> <span class="dim">#' + u.slug + '</span> &middot; <a class="ref" data-pin="' + u.id + '">' + (pins.includes(u.id) ? 'remove from compare' : 'compare') + '</a>');
  // Prefer the large unit_info portrait; fall back to the embedded card if the
  // portraits/ folder is missing (e.g. the site was shared as index.html alone).
  let card = '';
  if (u.pic) {
    card = '<div class="detail-card"><img alt="" loading="lazy" data-fb="' + u.id + '" src="' + u.pic + '"></div>';
  } else if (u.card) {
    card = '<div class="detail-card"><img alt="" class="small" data-last="1" src="' + u.card + '"></div>';
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
// ---- Reference module: ammunition / mounts / armour upgrades ----
const refModal = document.getElementById('ref-modal');
const refBox = refModal.querySelector('.ref-box');

function refRow(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }

function refUsers(title, list) {
  if (!list.length) return '';
  return '<div class="ref-users"><h3>' + title + ' (' + list.length + ')</h3>' +
    list.map(u => '<a class="ref-unit" data-id="' + u.id + '">' + esc(u.name) + '</a>').join('') + '</div>';
}

// ---- Side-by-side comparison ----
const pins = [];

function renderPins() {
  const bar = document.getElementById('cmp-bar');
  bar.hidden = pins.length === 0;
  document.getElementById('cmp-items').innerHTML = pins.map(id =>
    '<span class="pin">' + esc(UNITS[id].name) + '<a data-unpin="' + id + '" title="Remove">&times;</a></span>').join('');
  document.getElementById('cmp-go').disabled = pins.length < 2;
}

function openCompare() {
  const us = pins.map(id => UNITS[id]);
  let html = '<button class="ref-close">Close</button><span class="ref-kind">Side by side</span><h2>Comparison</h2><table>';
  html += '<tr><td></td>' + us.map(u =>
    '<th>' + (u.card ? '<img alt="" src="' + u.card + '">' : '') +
    '<a class="ref-unit" data-id="' + u.id + '">' + esc(u.name) + '</a></th>').join('') + '</tr>';
  const row = (label, vals, opts) => {
    opts = opts || {};
    const nums = vals.map(v => (typeof v === 'number' ? v : null));
    const present = nums.filter(v => v !== null);
    const best = present.length > 1 && Math.min(...present) !== Math.max(...present)
      ? (opts.lower ? Math.min(...present) : Math.max(...present)) : null;
    html += '<tr><td>' + label + '</td>' + vals.map((v, i) => {
      const txt = v === null || v === undefined || v === '' ? '<span class="dim">—</span>' : (opts.fmt ? opts.fmt(v, i) : v);
      return '<td' + (best !== null && nums[i] === best ? ' class="best"' : '') + '>' + txt + '</td>';
    }).join('') + '</tr>';
  };
  row('Faction', us.map(u => esc(u.faction)));
  row('Type', us.map(u => typeLabel(u)));
  row('Soldiers', us.map(u => u.men), { fmt: v => inGame(v) });
  row('Melee attack', us.map(u => u.atk), { fmt: (v, i) => v + badges(us[i].meleeAttr) });
  row('Charge', us.map(u => u.chg));
  row('Missile attack', us.map(u => u.msl), { fmt: (v, i) => v + badges(us[i].mslAttr) });
  row('Range', us.map(u => u.rng));
  row('Ammo', us.map(u => u.ammo));
  row('Defence', us.map(u => u.def), { fmt: (v, i) => v + ' <span class="def-split">(' + us[i].armour + '\\u00B7' + us[i].skill + '\\u00B7' + us[i].shield + ')</span>' });
  row('Morale', us.map(u => u.morale), { fmt: (v, i) => v + (us[i].lockMorale ? ' \\u221E' : '') });
  row('Hit points', us.map(u => u.hp));
  row('Heat fatigue', us.map(u => u.heat), { lower: true, fmt: v => (v ? '-' + v : '0') });
  row('Cost', us.map(u => u.cost), { lower: true });
  row('Upkeep', us.map(u => u.upkeep), { lower: true });
  row('Turns to train', us.map(u => u.turns), { lower: true });
  html += '</table><p class="ref-note">Green marks the best value in each row (lowest for cost, upkeep, turns and heat).</p>';
  refBox.className = 'ref-box wide';
  refBox.innerHTML = html;
  refModal.hidden = false;
}

document.getElementById('cmp-go').addEventListener('click', openCompare);
document.getElementById('cmp-clear').addEventListener('click', () => { pins.length = 0; renderPins(); render(); });

function openRef(kind, key) {
  refBox.className = 'ref-box';
  let html = '<button class="ref-close">Close</button>';
  if (kind === 'proj') {
    const p = PROJ[key];
    if (!p) return;
    html += '<span class="ref-kind">Ammunition</span><h2>' + esc(p.name) + '</h2><table>';
    if (p.damage) html += refRow('Bonus damage', '+' + p.damage);
    if (p.velocity) html += refRow('Velocity', p.velocity.join('\\u2013') + ' m/s');
    if (p.accuracy !== undefined) html += refRow('Scatter', p.accuracy + ' (lower is more accurate)');
    if (p.mass) html += refRow('Mass', p.mass);
    if (p.flags.length) html += refRow('Traits', p.flags.join(', '));
    html += '</table>';
    html += '<p class="ref-note">Heavier, faster missiles keep more punch at range; fire, poison and silverthorn shots carry the effects their name promises.</p>';
    html += refUsers('Fired by', UNITS.filter(u => u.mslName && u.mslName.toLowerCase() === key));
  } else if (kind === 'mount') {
    const m = MOUNTS[key];
    if (!m) return;
    html += '<span class="ref-kind">Mount</span><h2>' + esc(m.name) + '</h2><table>';
    if (m.class) html += refRow('Class', m.class + ' (mount_effect bonuses key off this)');
    if (m.mass) html += refRow('Mass', m.mass + ' (collision weight when charging)');
    if (m.radius) html += refRow('Size', 'radius ' + m.radius + (m.height ? ', height ' + m.height : '') + ' m');
    if (m.riders > 1) html += refRow('Riders', m.riders);
    html += '</table>';
    html += refUsers('Ridden by', UNITS.filter(u => u.mount && u.mount.toLowerCase() === key));
  } else if (kind === 'armour') {
    const u = UNITS[Number(key)];
    if (!u) return;
    html += '<span class="ref-kind">Armour upgrades</span><h2>' + esc(u.name) + '</h2><table>';
    html += refRow('Levels', u.armourUg.join(' \\u2192 '));
    html += refRow('Upgrades', (u.armourUg.length - 1) + ' (+1 armour each)');
    html += '</table>';
    html += '<p class="ref-note">Retraining in a settlement with a high enough tier of smith raises the unit through these armour levels: each step adds +1 to the armour stat (and often a more armoured look). The first number is the level the unit is recruited at.</p>';
  }
  refBox.innerHTML = html;
  refModal.hidden = false;
}

function jumpToUnit(id) {
  refModal.hidden = true;
  state.q = ''; state.faction = ''; state.cat = ''; state.sortKey = null;
  document.getElementById('q').value = '';
  document.getElementById('faction').value = '';
  for (const x of document.querySelectorAll('.catbtns button')) x.classList.toggle('active', x.dataset.cat === '');
  state.open.add(Number(id));
  setHash(UNITS[Number(id)].slug);
  render();
  const row = document.querySelector('tr.unit[data-id="' + id + '"]');
  if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); }
}

// ---- Deep links: the URL hash tracks the most recently opened unit ----
function setHash(slug) {
  history.replaceState(null, '', slug ? '#' + slug : location.pathname + location.search);
}
function openFromHash() {
  const slug = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!slug) return;
  const u = UNITS.find(x => x.slug === slug);
  if (u && !state.open.has(u.id)) jumpToUnit(u.id);
}
window.addEventListener('hashchange', openFromHash);

document.addEventListener('click', (e) => {
  const cp = e.target.closest('a[data-copy]');
  if (cp) {
    const slug = cp.dataset.copy;
    setHash(slug);
    const url = location.href.split('#')[0] + '#' + slug;
    const done = () => { cp.textContent = 'copied!'; setTimeout(() => { cp.textContent = 'copy link'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => {});
    return;
  }
  const pin = e.target.closest('a[data-pin]');
  if (pin) {
    const id = Number(pin.dataset.pin);
    const i = pins.indexOf(id);
    if (i >= 0) pins.splice(i, 1);
    else if (pins.length < 4) pins.push(id);
    renderPins();
    render(); // refresh "compare"/"remove from compare" labels in open details
    return;
  }
  const unpin = e.target.closest('a[data-unpin]');
  if (unpin) {
    pins.splice(pins.indexOf(Number(unpin.dataset.unpin)), 1);
    renderPins();
    render();
    return;
  }
  const ref = e.target.closest('a.ref');
  if (ref) { const [kind, key] = ref.dataset.ref.split(':'); openRef(kind, key); return; }
  const unitLink = e.target.closest('a.ref-unit');
  if (unitLink) { jumpToUnit(unitLink.dataset.id); return; }
  if (e.target.closest('.ref-close') || (e.target === refModal)) refModal.hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') refModal.hidden = true; });

// Image fallbacks when the portraits/ or cards/ folders are absent (e.g. the
// site was shared as index.html alone): detail portrait -> card -> remove;
// row thumbnail -> remove.
document.getElementById('rows').addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.fb) {
    const u = UNITS[Number(img.dataset.fb)];
    delete img.dataset.fb;
    if (u && u.card) { img.src = u.card; img.className = 'small'; img.dataset.last = '1'; }
    else img.closest('.detail-card')?.remove();
    return;
  }
  if (img.dataset.last) img.closest('.detail-card')?.remove();
  else if (img.classList.contains('card')) img.remove();
}, true);

document.getElementById('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr.unit');
  if (!tr) return;
  const id = Number(tr.dataset.id);
  if (state.open.has(id)) {
    state.open.delete(id);
    if (location.hash === '#' + UNITS[id].slug) setHash('');
  } else {
    state.open.add(id);
    setHash(UNITS[id].slug);
  }
  render();
});

// The browser's scroll restoration on reload would override the deep-link
// scroll; take over when the page is opened with a unit hash.
if (location.hash && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
render();
openFromHash();
// 'instant' overrides the page's smooth scrolling, which the browser can
// cancel while loading; re-assert after load because the browser's own
// (failed) fragment-scroll can override an earlier position.
// Late reflows (font swap, lazy images) shift the deep-linked row after the
// first scroll; keep it centred for the first moments unless the user
// intervenes.
const dlScroll = () => {
  const row = document.querySelector('tr.unit.open');
  if (!row) return;
  const r = row.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) row.scrollIntoView({ block: 'center', behavior: 'instant' });
};
if (location.hash) {
  let active = true;
  const stop = () => { active = false; };
  for (const evName of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
    window.addEventListener(evName, stop, { once: true, passive: true });
  }
  const tick = setInterval(() => { if (active) dlScroll(); }, 250);
  setTimeout(() => clearInterval(tick), 3000);
}
</script>
</body>
</html>
`;
}

// ----------------------------------------------------------- buildings page

function buildBuildingsHtml(model) {
  const bldJson = JSON.stringify(model.buildings);
  const generated = new Date().toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AGO — Buildings &amp; Guilds</title>
<link href="fonts/fonts.css" rel="stylesheet">
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
header .sub { font-style: italic; color: var(--ink-soft); margin: 6px 0 0; font-size: 17px; }
.sitenav { margin: 10px 0 0; font-family: var(--display); font-size: 12.5px; letter-spacing: .1em; text-transform: uppercase; }
.sitenav a { color: var(--ink-soft); text-decoration: none; padding: 2px 10px; border-bottom: 2px solid transparent; }
.sitenav a.active { color: var(--accent); border-bottom-color: var(--accent); }
.sitenav a:hover { color: var(--accent); }
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
.controls input[type=search] {
  font-family: var(--serif);
  font-size: 15px;
  color: var(--ink);
  background: #fbf6e7;
  border: 1px solid var(--line-dark);
  border-radius: 3px;
  padding: 4px 8px;
  width: 230px;
}
.controls select {
  font-family: var(--serif);
  font-size: 15px;
  color: var(--ink);
  background: #fbf6e7;
  border: 1px solid var(--line-dark);
  border-radius: 3px;
  padding: 4px 8px;
}
.catbtns { display: flex; flex-wrap: wrap; gap: 0; border: 1px solid var(--line-dark); border-radius: 3px; overflow: hidden; }
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
main { max-width: 1100px; margin: 0 auto; padding: 12px 14px 60px; }
table { width: 100%; border-collapse: collapse; }
thead th {
  position: sticky;
  top: var(--ctrlh, 49px);
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
  user-select: none;
  white-space: nowrap;
}
thead th.num { text-align: right; }
tbody td { padding: 4px 8px; border: 1px solid var(--line); font-size: 15px; }
td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
tr.bld { cursor: pointer; background: var(--parchment); }
tr.bld:nth-child(even of .bld) { background: var(--row-alt); }
tr.bld:hover { background: #e2d3ac; }
tr.bld.open { background: #ddcda2; }
td.name { font-weight: 600; font-size: 15.5px; }
td.name .guildtag { font-weight: 400; font-style: italic; color: var(--gold); font-size: 13px; margin-left: 8px; }
td.name .kindtag { font-weight: 400; font-style: italic; color: var(--ink-soft); font-size: 13px; margin-left: 8px; }
td.name img.bpic {
  height: 34px;
  width: 34px;
  object-fit: cover;
  vertical-align: middle;
  margin-right: 8px;
  border: 1px solid var(--line-dark);
  border-radius: 2px;
  background: #2e2418;
}
td.facs { color: var(--ink-soft); font-size: 13.5px; }
tr.cat-row td {
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
tr.cat-row td .fcount { color: var(--ink-soft); font-size: 12px; letter-spacing: .05em; margin-left: 8px; }
.dim { color: var(--ink-soft); font-size: 12.5px; }
tr.detail td {
  background: #faf3df;
  border: 1px solid var(--line-dark);
  padding: 12px 18px 14px;
  white-space: normal;
}
.bdesc { font-style: italic; color: var(--ink-soft); max-width: 80ch; margin: 0 0 6px; }
.lvl { display: flex; gap: 14px; align-items: flex-start; padding: 10px 0; border-top: 1px dotted var(--line); }
.lvl:first-of-type { border-top: none; }
.lvl img { width: 56px; height: 56px; object-fit: cover; border: 1px solid var(--line-dark); border-radius: 3px; background: #2e2418; flex: none; }
.lvl .tiername { font-weight: 600; font-size: 15.5px; }
.lvl .tiername .dim { font-weight: 400; }
.lvl .fx, .lvl .rec, .lvl .req { font-size: 14px; margin-top: 2px; }
.lvl .fx b, .lvl .rec b, .lvl .req b {
  font-family: var(--display);
  font-weight: 600;
  font-size: 10.5px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin-right: 6px;
}
.rgrp { margin: 2px 0 2px 8px; }
.rfac {
  font-family: var(--display);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--gold);
  margin-right: 6px;
}
.cond { border-bottom: 1px dotted var(--line-dark); cursor: help; }
.ghow { margin: 4px 0 10px; padding: 8px 12px; background: rgba(138,109,47,.07); border: 1px solid var(--line); border-radius: 3px; max-width: 80ch; }
.ghow > b {
  font-family: var(--display);
  font-weight: 600;
  font-size: 10.5px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--gold);
}
.ghow ul { margin: 4px 0 0; padding-left: 20px; font-size: 14px; }
.ghow li { margin: 2px 0; }
a.unitlink { color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); }
a.unitlink:hover { background: rgba(122,31,31,.08); }
tr.bld.flash { animation: rowflash 1.6s ease-out; }
@keyframes rowflash { 0% { background: #d8b86a; } 100% { background: var(--row-alt); } }
#tree { overflow-x: auto; }
#tree table { width: 100%; border-collapse: collapse; min-width: 760px; }
#tree td { padding: 4px 8px; border: 1px solid var(--line); font-size: 13.5px; vertical-align: top; background: var(--parchment); }
#tree tr:nth-child(even) td { background: var(--row-alt); }
#tree td.cname { font-weight: 600; font-size: 14px; }
#tree a.goto { color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); cursor: pointer; display: inline-block; margin: 1px 0; }
#tree a.goto:hover { background: rgba(122,31,31,.08); }
#tree .note { font-style: italic; color: var(--ink-soft); font-size: 13px; margin: 8px 0; }
.empty { text-align: center; font-style: italic; color: var(--ink-soft); padding: 30px; font-size: 17px; }
footer {
  text-align: center;
  font-style: italic;
  color: var(--ink-soft);
  font-size: 13.5px;
  padding: 14px;
  border-top: 3px double var(--line-dark);
}
@media (max-width: 620px) {
  body { font-size: 14px; }
  tbody td { padding: 3px 5px; font-size: 13.5px; }
  td.name { white-space: normal; }
  .hide-xs { display: none; }
  header h1 { font-size: 24px; }
  .controls input[type=search] { width: 130px; }
  main { padding: 8px 4px 60px; }
  .lvl { flex-direction: row; }
}
</style>
</head>
<body>
<header>
  <h1>AGO &mdash; Buildings &amp; Guilds</h1>
  <p class="sub">Every structure of Middle-earth, from palisade to citadel &middot; Medieval II: Total War</p>
  <nav class="sitenav"><a href="index.html">Units</a><a href="factions.html">Factions</a><a href="buildings.html" class="active">Buildings &amp; Guilds</a></nav>
</header>

<div class="controls">
  <input type="search" id="q" placeholder="Search buildings&hellip;" autocomplete="off">
  <select id="fac"><option value="">All factions</option></select>
  <span class="catbtns" id="cats">
    <button data-cat="" class="active">All</button>
    <button data-cat="Military">Military</button>
    <button data-cat="Defence">Defence</button>
    <button data-cat="Economy">Economy</button>
    <button data-cat="Civic">Civic</button>
    <button data-cat="Regional">Regional</button>
    <button data-cat="Guilds">Guilds</button>
    <button data-cat="Other">Other</button>
  </span>
  <span class="catbtns" id="views">
    <button data-view="list" class="active">List</button>
    <button data-view="tree">Tech tree</button>
  </span>
  <span class="catbtns" id="kinds" hidden>
    <button data-kind="city" class="active">City</button>
    <button data-kind="castle">Castle</button>
  </span>
  <span class="count" id="count"></span>
</div>

<main>
  <table id="listtbl">
    <thead>
      <tr>
        <th>Building</th>
        <th class="num">Tiers</th>
        <th class="num hide-xs">Cost</th>
        <th>Factions</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div id="tree" hidden></div>
  <div class="empty" id="empty" hidden>No buildings match these filters.</div>
</main>

<footer>Generated ${generated} from <code>export_descr_buildings.txt</code> &middot; ${model.buildings.length} building chains &middot; guild levels are offered when a settlement accumulates the listed guild points &middot; * = conditional bonus (hover for the requirement)</footer>

<script>
const BLD = ${bldJson};
BLD.forEach((b, i) => { b.id = i; });
const CATS = ['Military', 'Defence', 'Economy', 'Civic', 'Regional', 'Guilds', 'Other'];
const state = { q: '', cat: '', fac: '', view: 'list', kind: 'city', open: new Set() };

const $fac = document.getElementById('fac');
for (const f of [...new Set(BLD.flatMap(b => b.facs))].sort()) {
  const o = document.createElement('option');
  o.value = f;
  o.textContent = f;
  $fac.appendChild(o);
}

const setCtrlH = () => document.documentElement.style.setProperty('--ctrlh',
  document.querySelector('.controls').offsetHeight + 'px');
window.addEventListener('resize', setCtrlH);
setCtrlH();

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function matches(b) {
  if (state.cat && b.cat !== state.cat) return false;
  if (state.fac && b.facs.length && !b.facs.includes(state.fac)) return false;
  if (state.q) {
    const q = state.q.toLowerCase();
    const hay = (b.name + ' ' + b.levels.map(l => l.name + ' ' + Object.values(l.names).join(' ')).join(' ') + ' ' + b.facs.join(' ') + ' ' + b.guild).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function costRange(b) {
  const costs = b.levels.map(l => l.cost).filter(c => c > 0);
  if (!costs.length) return '<span class="dim">—</span>';
  const lo = Math.min(...costs), hi = Math.max(...costs);
  return lo === hi ? String(lo) : lo + '–' + hi;
}

// chains restricted to one settlement type get a tag, so the paired
// city/castle versions of a same-named chain are distinguishable
function chainKind(b) {
  const kinds = [...new Set(b.levels.map(l => l.kind))];
  return kinds.length === 1 && kinds[0] ? kinds[0] : '';
}

function rowHtml(b) {
  const first = b.levels.filter(lvlVisible)[0] || b.levels[0];
  const rpic = lvlPic(first);
  const pic = rpic ? '<img class="bpic" loading="lazy" alt="" src="' + rpic + '">' : '';
  const kind = chainKind(b);
  const facs = state.fac ? (b.facs.length ? state.fac : 'All factions')
    : b.facs.length ? (b.facs.length > 4 ? b.facs.slice(0, 4).join(', ') + ' +' + (b.facs.length - 4) : b.facs.join(', ')) : 'All factions';
  return '<tr class="bld' + (state.open.has(b.id) ? ' open' : '') + '" data-id="' + b.id + '">' +
    '<td class="name">' + pic + esc(lvlName(first)) + (b.guild ? '<span class="guildtag">guild</span>' : '') + (kind ? '<span class="kindtag">' + kind + '</span>' : '') + '</td>' +
    '<td class="num">' + b.tiers + '</td>' +
    '<td class="num hide-xs">' + costRange(b) + '</td>' +
    '<td class="facs">' + esc(facs) + '</td>' +
  '</tr>';
}

// faction-resolved name and picture for a level
function lvlName(l) { return (state.fac && l.names[state.fac]) || l.name; }
function lvlPic(l) { return (state.fac && l.pics[state.fac]) || l.pic; }
function lvlVisible(l) { return !state.fac || !l.facs.length || l.facs.includes(state.fac); }

function recruitLink(r) {
  return (r.s ? '<a class="unitlink" href="index.html#' + r.s + '">' + esc(r.n) + '</a>' : esc(r.n)) +
    (r.exp ? ' <span class="dim">+' + r.exp + ' exp</span>' : '');
}

function recruitsHtml(l) {
  if (!l.recruits.length) return '';
  if (state.fac) {
    const list = l.recruits.filter(r => !r.f.length || r.f.includes(state.fac));
    if (!list.length) return '';
    return '<div class="rec"><b>Recruits</b>' + list.map(recruitLink).join(', ') + '</div>';
  }
  // no faction selected: group by faction so rosters don't blend
  const groups = new Map();
  for (const r of l.recruits) {
    for (const k of (r.f.length ? r.f : ['Any owner'])) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
  }
  const order = [...groups.keys()].sort((a, b) =>
    a === 'Any owner' ? -1 : b === 'Any owner' ? 1 : a.localeCompare(b));
  if (order.length === 1) {
    return '<div class="rec"><b>Recruits</b>' + groups.get(order[0]).map(recruitLink).join(', ') + '</div>';
  }
  return '<div class="rec"><b>Recruits</b>' + order.map(k =>
    '<div class="rgrp"><span class="rfac">' + esc(k) + '</span>' + groups.get(k).map(recruitLink).join(', ') + '</div>').join('') + '</div>';
}

function levelHtml(l) {
  const head = 'Tier ' + l.tier + '/' + l.of + ' — ' + esc(lvlName(l)) +
    ' <span class="dim">' + [l.kind, l.cost ? l.cost + ' gold' : '', l.time ? l.time + (l.time === 1 ? ' turn' : ' turns') : '', l.min && l.min !== 'village' ? 'from ' + esc(l.min) : ''].filter(Boolean).join(' · ') + '</span>';
  const parts = ['<div class="tiername">' + head + '</div>'];
  const fx = (state.fac && l.ffx[state.fac]) || l.effects;
  if (fx.length) parts.push('<div class="fx"><b>Effects</b>' + fx.join(' · ') + '</div>');
  const rec = recruitsHtml(l);
  if (rec) parts.push(rec);
  const reqs = [];
  if (l.points !== null && l.points !== undefined) reqs.push(l.points + ' guild points');
  if (l.hr.length) reqs.push('region: ' + l.hr.join(', '));
  if (l.ev.length) reqs.push('event: ' + l.ev.join(', '));
  if (reqs.length) parts.push('<div class="req"><b>Requires</b>' + esc(reqs.join(' · ')) + '</div>');
  const pic = lvlPic(l) ? '<img loading="lazy" alt="" src="' + lvlPic(l) + '">' : '';
  return '<div class="lvl">' + pic + '<div>' + parts.join('') + '</div></div>';
}

function detailHtml(b) {
  const desc = b.desc ? '<p class="bdesc">' + esc(b.desc) + '</p>' : '';
  let guild = '';
  if (b.how.length || b.gfacs.length) {
    guild = '<div class="ghow"><b>Earning guild points</b>' +
      (b.gfacs.length ? '<div class="dim">Offered to: ' + esc(b.gfacs.join(', ')) + '</div>' : '') +
      '<ul>' + b.how.map(h => '<li>' + esc(h) + '</li>').join('') + '</ul></div>';
  }
  const ls = b.levels.filter(lvlVisible);
  return '<tr class="detail"><td colspan="4">' + desc + guild + ls.map(levelHtml).join('') + '</td></tr>';
}

// ---- Tech-tree view: which tier unlocks at which settlement size ----
const SIZES = ['village', 'town', 'large town', 'city', 'large city', 'huge city'];
// castle settlements use the same six internal size steps, but with their own
// stage names — switching the toggle relabels the columns accordingly
const SIZE_LABELS = {
  city: ['Village', 'Town', 'Large Town', 'City', 'Large City', 'Huge City'],
  castle: ['Village', 'Motte &amp; Bailey', 'Wooden Castle', 'Castle', 'Fortress', 'Citadel'],
};

function treeLevels(b) {
  return b.levels.filter(l =>
    (l.kind === '' || l.kind === state.kind) &&
    (!state.fac || !l.facs.length || l.facs.includes(state.fac)));
}

function renderTree(list) {
  let html = '<table><thead><tr><th>Building</th>' + SIZE_LABELS[state.kind].map(s => '<th>' + s + '</th>').join('') + '</tr></thead><tbody>';
  let shown = 0;
  for (const cat of CATS) {
    const group = list.filter(b => b.cat === cat).map(b => ({ b, ls: treeLevels(b) })).filter(x => x.ls.length);
    if (!group.length) continue;
    html += '<tr class="cat-row"><td colspan="7">' + cat + '<span class="fcount">' + group.length + (group.length === 1 ? ' chain' : ' chains') + '</span></td></tr>';
    for (const { b, ls } of group) {
      shown += 1;
      html += '<tr><td class="cname">' + esc(lvlName(ls[0])) + '</td>' + SIZES.map(size => {
        const here = ls.filter(l => (l.min || 'village') === size);
        return '<td>' + here.map(l =>
          '<a class="goto" data-goto="' + b.slug + '" title="Open in list view">' + esc(lvlName(l)) + '</a>' +
          (l.points !== null && l.points !== undefined ? ' <span class="dim">' + l.points + ' pts</span>' : '')
        ).join('<br>') + '</td>';
      }).join('') + '</tr>';
    }
  }
  html += '</tbody></table>';
  document.getElementById('tree').innerHTML = html;
  return shown;
}

function render() {
  const list = BLD.filter(matches);
  const isTree = state.view === 'tree';
  document.getElementById('listtbl').hidden = isTree;
  document.getElementById('tree').hidden = !isTree;
  document.getElementById('kinds').hidden = !isTree;
  let shown = list.length;
  if (isTree) {
    shown = renderTree(list);
    document.getElementById('rows').innerHTML = '';
  } else {
    let html = '';
    for (const cat of CATS) {
      const group = list.filter(b => b.cat === cat);
      if (!group.length) continue;
      html += '<tr class="cat-row"><td colspan="4">' + cat + '<span class="fcount">' + group.length + (group.length === 1 ? ' chain' : ' chains') + '</span></td></tr>';
      for (const b of group) {
        html += rowHtml(b);
        if (state.open.has(b.id)) html += detailHtml(b);
      }
    }
    document.getElementById('rows').innerHTML = html;
    document.getElementById('tree').innerHTML = '';
  }
  document.getElementById('empty').hidden = shown > 0;
  document.getElementById('count').textContent = shown + ' of ' + BLD.length + ' chains';
}

document.getElementById('q').addEventListener('input', (e) => { state.q = e.target.value.trim(); render(); });
$fac.addEventListener('change', (e) => { state.fac = e.target.value; render(); });
document.getElementById('cats').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  state.cat = btn.dataset.cat;
  for (const x of document.querySelectorAll('#cats button')) x.classList.toggle('active', x === btn);
  render();
});
document.getElementById('views').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  state.view = btn.dataset.view;
  for (const x of document.querySelectorAll('#views button')) x.classList.toggle('active', x === btn);
  render();
});
document.getElementById('kinds').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  state.kind = btn.dataset.kind;
  for (const x of document.querySelectorAll('#kinds button')) x.classList.toggle('active', x === btn);
  render();
});
// tree cell -> open the chain in list view
document.getElementById('tree').addEventListener('click', (e) => {
  const a = e.target.closest('a[data-goto]');
  if (!a) return;
  state.view = 'list';
  for (const x of document.querySelectorAll('#views button')) x.classList.toggle('active', x.dataset.view === 'list');
  const b = BLD.find(x => x.slug === a.dataset.goto);
  if (b) { state.open.add(b.id); setHash(b.slug); }
  render();
  const row = b && document.querySelector('tr.bld[data-id="' + b.id + '"]');
  if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); }
});

function setHash(slug) {
  history.replaceState(null, '', slug ? '#' + slug : location.pathname + location.search);
}
function openFromHash() {
  const slug = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!slug) return;
  const b = BLD.find(x => x.slug === slug);
  if (!b || state.open.has(b.id)) return;
  state.q = ''; state.cat = '';
  document.getElementById('q').value = '';
  for (const x of document.querySelectorAll('#cats button')) x.classList.toggle('active', x.dataset.cat === '');
  state.open.add(b.id);
  render();
  const row = document.querySelector('tr.bld[data-id="' + b.id + '"]');
  if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); }
}
window.addEventListener('hashchange', openFromHash);

document.getElementById('rows').addEventListener('click', (e) => {
  if (e.target.closest('a')) return; // unit links navigate, don't toggle
  const tr = e.target.closest('tr.bld');
  if (!tr) return;
  const id = Number(tr.dataset.id);
  if (state.open.has(id)) {
    state.open.delete(id);
    if (location.hash === '#' + BLD[id].slug) setHash('');
  } else {
    state.open.add(id);
    setHash(BLD[id].slug);
  }
  render();
});

// drop broken images (buildingpics/ folder absent)
document.getElementById('rows').addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.remove();
}, true);

if (location.hash && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
render();
openFromHash();
// Late reflows (font swap, lazy images) shift the deep-linked row after the
// first scroll; keep it centred for the first moments unless the user
// intervenes.
const dlScroll = () => {
  const row = document.querySelector('tr.bld.open');
  if (!row) return;
  const r = row.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) row.scrollIntoView({ block: 'center', behavior: 'instant' });
};
if (location.hash) {
  let active = true;
  const stop = () => { active = false; };
  for (const evName of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
    window.addEventListener(evName, stop, { once: true, passive: true });
  }
  const tick = setInterval(() => { if (active) dlScroll(); }, 250);
  setTimeout(() => clearInterval(tick), 3000);
}
</script>
</body>
</html>
`;
}

// ------------------------------------------------------------ factions page

function buildFactionsHtml(model) {
  const facJson = JSON.stringify(model.factionPages);
  const generated = new Date().toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AGO — Factions</title>
<link href="fonts/fonts.css" rel="stylesheet">
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
  padding: 26px 16px 14px;
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
header .sub { font-style: italic; color: var(--ink-soft); margin: 6px 0 0; font-size: 17px; }
.sitenav { margin: 10px 0 0; font-family: var(--display); font-size: 12.5px; letter-spacing: .1em; text-transform: uppercase; }
.sitenav a { color: var(--ink-soft); text-decoration: none; padding: 2px 10px; border-bottom: 2px solid transparent; }
.sitenav a.active { color: var(--accent); border-bottom-color: var(--accent); }
.sitenav a:hover { color: var(--accent); }
main { max-width: 1100px; margin: 0 auto; padding: 12px 14px 60px; }
h2.side {
  font-family: var(--display);
  font-weight: 700;
  font-size: 17px;
  letter-spacing: .14em;
  text-transform: uppercase;
  text-align: center;
  margin: 26px 0 10px;
  padding: 7px 10px;
  border: 1px solid var(--line-dark);
  border-top: 2px solid var(--line-dark);
  background: linear-gradient(90deg, var(--parchment-dark), #f0e7cf 40%, var(--parchment-dark));
}
h2.side.good { color: var(--good); }
h2.side.evil { color: var(--bad); }
.fcard {
  border: 1px solid var(--line-dark);
  border-radius: 3px;
  background: var(--parchment);
  margin: 0 0 10px;
  cursor: pointer;
}
.fcard:hover { background: #efe6cd; }
.fcard.open { background: #f7f0dd; cursor: default; }
.fhead { display: flex; align-items: center; gap: 14px; padding: 8px 14px; }
.fhead img { width: 44px; height: 44px; object-fit: contain; flex: none; }
.fhead .fname { font-family: var(--display); font-weight: 700; font-size: 19px; letter-spacing: .06em; }
.fhead .fmeta { color: var(--ink-soft); font-size: 13.5px; margin-top: 1px; }
.fhead .fnum {
  margin-left: auto;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink-soft);
  font-size: 13.5px;
  white-space: nowrap;
}
.fbody { display: none; padding: 0 16px 14px; border-top: 1px dotted var(--line); }
.fcard.open .fbody { display: block; }
.fbody .cols { display: flex; gap: 28px; flex-wrap: wrap; margin-top: 10px; }
.fbody .col { flex: 1 1 300px; min-width: 260px; }
.fbody h3 {
  font-family: var(--display);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin: 12px 0 4px;
}
.fbody p { margin: 0 0 8px; max-width: 80ch; text-align: justify; hyphens: auto; }
.fbody .quote { font-style: italic; color: var(--ink-soft); }
.fbody a.unitlink { color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); cursor: pointer; }
.fbody a.unitlink:hover { background: rgba(122,31,31,.08); }
.fbody .roster {
  font-family: var(--display);
  font-size: 12px;
  letter-spacing: .04em;
  border: 1px solid var(--line-dark);
  border-radius: 3px;
  background: var(--accent);
  color: #f6eeda;
  padding: 4px 12px;
  text-decoration: none;
  display: inline-block;
  margin-top: 10px;
}
.dim { color: var(--ink-soft); font-size: 12.5px; }
footer {
  text-align: center;
  font-style: italic;
  color: var(--ink-soft);
  font-size: 13.5px;
  padding: 14px;
  border-top: 3px double var(--line-dark);
}
@media (max-width: 620px) {
  body { font-size: 14px; }
  header h1 { font-size: 24px; }
  .fhead .fnum { display: none; }
  main { padding: 8px 6px 60px; }
}
</style>
</head>
<body>
<header>
  <h1>AGO &mdash; Factions</h1>
  <p class="sub">The free peoples and the shadow &middot; Medieval II: Total War</p>
  <nav class="sitenav"><a href="index.html">Units</a><a href="factions.html" class="active">Factions</a><a href="buildings.html">Buildings &amp; Guilds</a></nav>
</header>

<main id="main"></main>

<footer>Generated ${generated} from <code>campaign_descriptions.txt</code> &amp; <code>factionData.lua</code> &middot; ${model.factionPages.length} playable factions &middot; click a faction for its full campaign overview</footer>

<script>
const FAC = ${facJson};
FAC.forEach((f, i) => { f.id = i; });
const open = new Set();

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tierLine(list) {
  return list.map(u => u.s
    ? '<a class="unitlink" href="index.html#' + u.s + '">' + esc(u.n) + '</a>'
    : esc(u.n)).join(', ');
}

// The campaign blurb: bold the section headers, italicise the lore quote.
function descrHtml(f) {
  const paras = f.descr.split(/\\n+/).map(p => p.trim()).filter(Boolean)
    .filter(p => !/^(Leader|Heir|Capital):/.test(p));
  return paras.map(p => {
    const hm = p.match(/^([A-Z][\\w'\\u2019 -]{2,30}):\\s*([\\s\\S]*)$/);
    if (hm) return '<h3>' + esc(hm[1]) + '</h3>' + (hm[2] ? '<p>' + esc(hm[2]) + '</p>' : '');
    if (/^[\\u201c"]/.test(p)) return '<p class="quote">' + esc(p) + '</p>';
    if (/^-\\s/.test(p)) return '<p>' + esc(p) + '</p>';
    return '<p>' + esc(p) + '</p>';
  }).join('');
}

// Factions differ in how far their smiths can upgrade unit armour; events can
// unlock levels beyond the everyday maximum.
function smithHtml(f) {
  const s = f.smith;
  if (!s || (!s.base && !s.cond)) return '';
  const link = s.slug
    ? ' &middot; via <a class="unitlink" href="buildings.html#' + s.slug + '">' + esc(s.cname) + '</a>'
    : '';
  let txt;
  if (s.base) {
    txt = 'Smiths can upgrade unit armour to level ' + s.base +
      (s.cond ? ', and to level ' + s.cond + ' through special events or buildings' : '') + '.';
  } else {
    txt = 'Armour upgrades (to level ' + s.cond + ') only through special events or buildings.';
  }
  return '<h3>Armour upgrades</h3><p>' + txt + link + '</p>';
}

function cardHtml(f) {
  const c = f.counts;
  const breakdown = [
    c.infantry && c.infantry + ' infantry', c.ranged && c.ranged + ' ranged',
    c.cavalry && c.cavalry + ' cavalry', c.siege && c.siege + ' siege', c.ships && c.ships + ' ships',
  ].filter(Boolean).join(' · ');
  const meta = [f.leader && 'Leader: ' + f.leader, f.capital && 'Capital: ' + f.capital].filter(Boolean).join(' · ');
  let body = '';
  if (open.has(f.id)) {
    body = '<div class="fbody">' +
      '<div class="cols"><div class="col">' + descrHtml(f) + '</div>' +
      '<div class="col">' +
      (f.heir ? '<h3>Heir</h3><p>' + esc(f.heir) + '</p>' : '') +
      '<h3>Roster (' + c.total + ' units)</h3><p>' + breakdown + '</p>' +
      smithHtml(f) +
      (f.low.length ? '<h3>Early units</h3><p>' + tierLine(f.low) + '</p>' : '') +
      (f.mid.length ? '<h3>Mid-tier units</h3><p>' + tierLine(f.mid) + '</p>' : '') +
      (f.high.length ? '<h3>Elite units</h3><p>' + tierLine(f.high) + '</p>' : '') +
      '<a class="roster" href="index.html?faction=' + encodeURIComponent(f.section) + '">View full roster &rarr;</a>' +
      '</div></div></div>';
  }
  return '<div class="fcard' + (open.has(f.id) ? ' open' : '') + '" data-id="' + f.id + '">' +
    '<div class="fhead">' +
    (f.sym ? '<img alt="" src="' + f.sym + '">' : '') +
    '<div><div class="fname">' + esc(f.name) + '</div>' +
    (meta ? '<div class="fmeta">' + esc(meta) + '</div>' : '') + '</div>' +
    '<div class="fnum">' + c.total + ' units</div>' +
    '</div>' + body + '</div>';
}

function render() {
  let html = '';
  const SIDE_TITLES = { good: 'The Free Peoples', evil: 'The Shadow', neutral: 'Neutral Powers', '': 'Others' };
  for (const side of ['good', 'neutral', 'evil', '']) {
    const group = FAC.filter(f => f.side === side);
    if (!group.length) continue;
    html += '<h2 class="side ' + side + '">' + SIDE_TITLES[side] + '</h2>';
    html += group.map(cardHtml).join('');
  }
  document.getElementById('main').innerHTML = html;
}

document.getElementById('main').addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const card = e.target.closest('.fcard');
  if (!card) return;
  const id = Number(card.dataset.id);
  // clicking the header of an open card closes it
  if (open.has(id)) {
    if (!e.target.closest('.fbody')) {
      open.delete(id);
      if (location.hash === '#' + FAC[id].slug) history.replaceState(null, '', location.pathname);
    }
  } else {
    open.add(id);
    history.replaceState(null, '', '#' + FAC[id].slug);
  }
  render();
});

document.getElementById('main').addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement) e.target.remove();
}, true);

function openFromHash() {
  const slug = decodeURIComponent(location.hash.replace(/^#/, ''));
  const f = FAC.find(x => x.slug === slug);
  if (!f || open.has(f.id)) return;
  open.add(f.id);
  render();
  document.querySelector('.fcard[data-id="' + f.id + '"]')?.scrollIntoView({ block: 'start', behavior: 'instant' });
}
window.addEventListener('hashchange', openFromHash);

if (location.hash && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
render();
openFromHash();
if (location.hash) {
  let active = true;
  const stop = () => { active = false; };
  for (const evName of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
    window.addEventListener(evName, stop, { once: true, passive: true });
  }
  const keep = () => {
    const card = document.querySelector('.fcard.open');
    if (!card) return;
    const r = card.getBoundingClientRect();
    if (r.top < 0 || r.top > innerHeight * 0.5) card.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  const tick = setInterval(() => { if (active) keep(); }, 250);
  setTimeout(() => clearInterval(tick), 3000);
}
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------- run

const model = buildModel();
fs.writeFileSync(OUT_HTML, buildHtml(model), 'utf8');
fs.writeFileSync(OUT_BHTML, buildBuildingsHtml(model), 'utf8');
fs.writeFileSync(OUT_FHTML, buildFactionsHtml(model), 'utf8');

// prune building pictures the model no longer references (default pics are
// now culture-suffixed, orphaning the old unsuffixed exports)
{
  const used = new Set();
  for (const b of model.buildings) {
    for (const l of b.levels) {
      if (l.pic) used.add(path.basename(l.pic));
      for (const p of Object.values(l.pics)) used.add(path.basename(p));
    }
  }
  if (fs.existsSync(OUT_BPICS)) {
    let pruned = 0;
    for (const f of fs.readdirSync(OUT_BPICS)) {
      if (f.endsWith('.png') && !used.has(f)) { fs.unlinkSync(path.join(OUT_BPICS, f)); pruned += 1; }
    }
    if (pruned) console.log(`Pruned ${pruned} unreferenced building pictures.`);
  }
}
console.log(`Factions page: ${model.factionPages.length} playable factions.`);
console.log(`Parsed ${model.units.length} units across ${model.factions.length} sections (${model.eopCount} added from eopData).`);
console.log(`Buildings: ${model.buildings.length} chains (${model.buildings.filter((b) => b.cat === 'Guilds').length} guild chains).`);
console.log(`${model.recruitable} units have building recruitment data; ${model.mercCount} have mercenary pools.`);
if (model.missingNames) console.log(`${model.missingNames} units had no entry in export_units.txt (internal name used).`);
if (model.missingCards) console.log(`${model.missingCards} units had no card image in data/ui/units/mercs.`);
if (model.missingPortraits) console.log(`${model.missingPortraits} units had no portrait in data/ui/unit_info/merc.`);
for (const [dir, label] of [[OUT_PORTRAITS, 'portraits/'], [OUT_CARDS, 'cards/'], [OUT_BPICS, 'buildingpics/']]) {
  if (!fs.existsSync(dir)) continue;
  const pics = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  const mb = pics.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0) / 1048576;
  console.log(`${label}: ${pics.length} PNGs, ${mb.toFixed(1)} MB`);
}
console.log(`Wrote ${OUT_HTML} (${(fs.statSync(OUT_HTML).size / 1024).toFixed(0)} KB)`);
