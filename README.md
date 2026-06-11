# AGO — Unit Compendium

A self-contained website displaying every unit in the AGO mod, with names,
descriptions, and battle stats merged from the mod's data files.

## Viewing

Just open `index.html` in any browser — no server or internet connection
required. The classical fonts are self-hosted in `fonts/` (no Google Fonts
dependency, so the site renders correctly in regions where Google is blocked);
without the folder the page falls back to system serif fonts.

## Sharing

Two options:

- **Quick** — send `index.html` alone (~5.5 MB). Everything works; expanded
  units show the small unit card.
- **Full** — send `index.html` together with the `portraits/` folder (~64 MB),
  or host both on GitHub Pages / Netlify. Expanded units then show the large
  in-game unit portrait, falling back to the card automatically if a portrait
  is missing.

## Rebuilding after a mod update

The site is generated from:

- `../data/text/export_units.txt` — unit names and descriptions
- `../data/export_descr_unit.txt` — unit stats
- `../data/ui/units/mercs/#*.tga` — unit cards (converted to PNG and embedded at build time)
- `../data/ui/unit_info/merc/*_info.tga` — large unit portraits (converted to
  PNG in `portraits/`; only changed files are reconverted)
- `../eopData/eopScripts/Units/EOPDU.lua` + `Resources/Unit_Types/*.txt` —
  extra units injected at runtime by M2TWEOP (marked with an EOP badge;
  stat-identical `rootUnit` bodyguard clones are skipped)

Whenever those files change, regenerate the page with:

```
node build.js
```

This rewrites `index.html` in place. No dependencies are needed beyond Node.

## Features

- All 606 units (531 from the base files + 75 M2TWEOP additions) grouped by
  faction, in mod file order, each with its in-game unit card
- Special formations (shield wall, phalanx, schiltrom, wedge, horde) and bonuses vs mounts in the expanded view
- Search box, faction dropdown, and category filters (infantry / cavalry / ranged / siege / ships)
- Click any column header to sort (once = descending, twice = ascending, third click returns to faction grouping)
- Click any unit row to expand its full description and complete stat breakdown
- Badges: **AP** armour-piercing, **BP** body-piercing, **SP** spear bonus, **∞** morale-locked (never routs)
- Def column shows total (armour · defence skill · shield)
