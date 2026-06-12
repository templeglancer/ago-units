# AGO — Unit Compendium

Live at **https://agocompendium.com** (GitHub Pages behind Cloudflare).

A self-contained website displaying every unit in the AGO mod, with names,
descriptions, and battle stats merged from the mod's data files. A companion
page, **buildings.html**, catalogues every building chain and guild.

## Viewing

Just open `index.html` in any browser — no server or internet connection
required. The classical fonts are self-hosted in `fonts/` (no Google Fonts
dependency, so the site renders correctly in regions where Google is blocked);
without the folder the page falls back to system serif fonts.

## Sharing

Two options:

- **Quick** — send `index.html` alone (~1.5 MB). All data, search, filters and
  comparison work; unit images are simply absent.
- **Full** — send `index.html` together with the `cards/` folder (~4 MB) and,
  optionally, the `portraits/` folder (~73 MB), or host everything on GitHub
  Pages / Netlify. Cards appear in the table rows; expanded units show the
  large in-game portrait, falling back to the card automatically if a portrait
  is missing.

## Rebuilding after a mod update

The site is generated from:

- `../data/text/export_units.txt` — unit names and descriptions
- `../data/export_descr_unit.txt` — unit stats
- `../data/ui/units/mercs/#*.tga` — unit cards (converted to PNG in `cards/`;
  only changed files are reconverted)
- `../data/ui/unit_info/merc/*_info.tga` — large unit portraits (converted to
  PNG in `portraits/`; only changed files are reconverted)
- `../data/world/maps/campaign/imperial_campaign/descr_mercenaries.txt` —
  region-based mercenary pools (cost, replenish rate, regions, which factions
  can hire)
- `../data/export_descr_guilds.txt` — guild-point thresholds for guild levels
- `../data/text/export_buildings.txt` — building names and descriptions
- `../data/ui/<culture>/buildings/#*.tga` — building pictures (converted to
  PNG in `buildingpics/`)
- `../eopData/eopScripts/Units/EOPDU.lua` + `Resources/Unit_Types/*.txt` —
  extra units injected at runtime by M2TWEOP (marked with an EOP badge;
  stat-identical `rootUnit` bodyguard clones are skipped)

Whenever those files change, regenerate the page with:

```
node build.js
```

This rewrites `index.html` and `buildings.html` in place. No dependencies are
needed beyond Node.

## Features

- All 606 units (531 from the base files + 75 M2TWEOP additions) grouped by
  faction, in mod file order, each with its in-game unit card
- Special formations (shield wall, phalanx, schiltrom, wedge, horde) and bonuses vs mounts in the expanded view
- Search box, faction dropdown, and category filters (infantry / cavalry / ranged / siege / ships)
- Click any column header to sort (once = descending, twice = ascending, third click returns to faction grouping)
- Click any unit row to expand its full description and complete stat breakdown
- Badges: **AP** armour-piercing, **BP** body-piercing, **SP** spear bonus, **∞** morale-locked (never routs)
- Recruitment buildings: the expanded view lists every building level that
  trains the unit (from `export_descr_buildings.txt`) with its tier,
  city/castle chain, pool size, replenish rate ("+1 every ~N turns"),
  experience bonus, and region/event requirements
- Mercenary hire: field-hire pools (from `descr_mercenaries.txt`) with cost,
  replenish range, pool size, the provinces where the unit can be hired, and
  which factions may hire it; units with no recruitment source at all show an
  Availability note (bodyguard / event / script) instead
- Reference cards: in the expanded view, the ammunition type, mount, and
  armour-upgrade levels are clickable — each opens a card with its game data
  (from `descr_projectile.txt` / `descr_mount.txt` / `armour_ug_levels`) and
  cross-links to every unit sharing it
- Def column shows total (armour · defence skill · shield)
- Deep links: opening a unit puts `#unit-slug` in the URL, and every expanded
  view has a "copy link" action — `https://agocompendium.com/#uruk-hai-infantry`
  opens the site scrolled to that unit with its details expanded
- Side-by-side comparison: a "compare" action in each expanded view pins up to
  four units to a bottom bar; the comparison table highlights the best value in
  each row (lowest for cost, upkeep, turns and heat)
- Mobile layout: narrow screens keep the six key columns (Unit, Men, Atk, Msl,
  Def, Cost) and show everything else in the expanded view
- Buildings & Guilds page: all 149 building chains grouped by category
  (Military / Defence / Economy / Civic / Regional / Guilds), each expanding
  into a tier ladder with picture, construction cost and time, curated effects
  (walls, law, growth, trade, upgrade tiers…), recruited units linking back to
  the unit page, and guild-point thresholds for the 15 guild chains; unit-page
  "Buildings" rows link across the other way
