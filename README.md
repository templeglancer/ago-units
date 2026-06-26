# AGO — Unit Compendium

Live at **https://agocompendium.com** (GitHub Pages behind Cloudflare).

A self-contained website. The homepage **index.html** is an archive-hall
portal — a hero, a unit search, and section cards into every part of the
site (old `index.html#unit-slug` / `?faction=` links redirect to units.html
so shared bookmarks keep working). The portal search is a **global search**
across every section (units, factions, buildings, traits, retinue, heroes,
provinces, events, mechanics) — results grouped by kind, each linking to its
entry; the index is a standalone `search-index.js` lazy-loaded on first
focus (a script, not a fetch, so it works offline too). **units.html** is the unit compendium
itself (every unit's names, descriptions and battle stats merged from the
mod's data files, with table and war-card views). Companion
pages: **buildings.html** (every building chain and guild, with a settlement
tech-tree view), **factions.html** (campaign overviews and questlines for all
26 playable factions), **characters.html** (every visible character trait
with its level thresholds, effects and earning triggers, plus the full
retinue of followers and items, and a Heroes & powers group: the Nine
Nazgul with dread, traits, relics, bodyguards and respawn rules, plus all
scripted battle abilities with effects and earning requirements) and **regions.html** (the world atlas: all
198 provinces with starting owner, settlement type and population, religion
mix, regional traits, scripted garrisons and local rebel forces, plus the
minor settlements and scripted landmarks) and **annals.html** (all 557
event scrolls the campaign can show, grouped by faction with search, plus
the natural-calamity scrolls) and **mechanics.html** (a reference for the
game systems: a combat primer - attack/defence, armour-piercing, charge,
missiles, morale, experience, clearly marked as community-established
engine knowledge - plus the One Ring constants and stages, the six
Palantiri, spy-network costs, raiding multipliers and every AGO.cfg
player toggle with a description) and **about.html** (the mod team's credits). Every page footer shows a random Tolkien
loading-screen quote from the mod`s 850. **changes.html** lists every unit
whose values changed in the latest update (old → new, with added/removed
units), and changed units carry a Δ badge with an inline delta in their
expanded view. **analytics.html** is a unit-stats dashboard: a configurable
scatter (any stat vs any stat, with a least-squares value line when cost or
upkeep is on the X axis), role colouring, faction/role filters, and
value-for-gold leaderboards. The unit compare tray also overlays a stat
radar and value-for-gold efficiency rows.

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

This rewrites all pages in place. No dependencies are needed beyond Node.

### Updating to a new mod version (value-change archive)

The site keeps a baseline snapshot of unit values in `archive/baseline.json`
and shows what changed since then on `changes.html`. When a new mod version
arrives, run these in order:

```
node build.js --snapshot   # freeze the CURRENT (old) values as the baseline
# ...now apply the mod update to ../data and ../eopData...
node build.js              # rebuild; changes.html diffs new values vs baseline
```

`--snapshot` only writes the baseline and exits; a normal build diffs the
current data against it. The baseline advances only when you re-run
`--snapshot`, so "changes since the last update" stays meaningful.

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
- Guild chains also explain how guild points are earned (from the eopData
  guild scripts) and which factions are offered each guild
- Script-created M2TWEOP buildings are included with an EOP badge: the
  Dorwinion Kantor (from `dorwinionEncircleSea.lua`) — trade outposts that
  appear after the "Encircle the Sea of Rhûn" event and exchange recruits
  between Dorwinion and its trade partners
- Faction names are unified to the in-game names everywhere: conditional
  effect tooltips and event requirements translate the vanilla tags the mod
  is built on ("sicily" shows as Gondor, "normans" as Bree-land, culture
  tokens expand to their factions)
- Shared chains are faction-aware: recruit lists are grouped per faction, and
  selecting a faction in the dropdown shows that faction's own building names,
  pictures, recruits and effect values (e.g. Isengard's tier of the governance
  chain appears as "Slave Pit" with Uruk recruits, not "Meeting Hall"; the
  smith chain's merged "Armour upgrades level 3–7" resolves to that faction's
  exact tier, with event-unlocked levels kept as conditional notes)
- Chains restricted to one settlement type carry a small city/castle tag, so
  the paired city and castle versions of a same-named chain (two "Stables"
  rows) are distinguishable
- Default building pictures (no faction selected) come from a single culture's
  art series per chain, preferring the Gondor and elven sets; each faction's
  own pictures still appear when it is selected in the dropdown
- Tech-tree view on the buildings page: a settlement-size grid (Village →
  Huge City, city or castle, filterable by faction) showing which building
  tier unlocks at each size — a per-faction build planner; the castle toggle
  relabels the columns with the castle stage names (Motte & Bailey → Citadel)
- Factions page (`factions.html`): all 26 playable factions grouped into Free
  Peoples / Neutral / Shadow, each with its symbol, leader and capital, the
  campaign-selection overview (folded to its first two sections, with a
  "Read the full overview" unfold), roster breakdown, and early/mid/elite
  unit tiers (from `factionData.lua`) linking to the unit page; "View full
  roster" opens the unit page pre-filtered (`index.html?faction=...`)
- Each faction card also states how far its smiths can upgrade unit armour
  (factions differ widely: level 3 for Rohan, level 7 for the dwarven realms)
  with event-unlocked levels noted separately, linking to the smith chain on
  the buildings page
- Characters page (`characters.html`): 566 visible traits (generals' and
  agents') with their level ladders ("Brave → Dauntless → … at 1/2/4/8/16
  points"), effects, opposed traits, and — invisible in game — the triggers
  that award the points (when they fire, their conditions with game faction
  names, and the chance); plus all 826 retinue followers and items with
  pictures (`ancpics/`), effects and acquisition triggers
- Questlines & campaign scripts: every faction card lists its unique quests
  and scripted features (95 across the 26 factions, from the in-game faction
  overview in `eopData/.../factionOverviews.lua`) — rendered as a chronicle
  index: scannable title rows with dotted leaders, each unfolding the mod
  team's description of triggers, choices and rewards on demand
- Victory conditions (long and short campaign, with province and faction
  names resolved) and the faction's named starting heroes (role, age, and a
  star for those carrying a scripted battle ability) on every faction card
- Chronicles & events: below the questlines, the in-game scroll texts and
  event popups from each faction's campaign scripts (`Faction_Scripts/`,
  only the files agoV3.lua actually loads) — 62 quest announcements,
  choices and reward notices with their lore quotes, in the same index
  style (factions whose scripts build texts dynamically have none)
