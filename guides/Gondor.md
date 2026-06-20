# Gondor — Faction Strategy Guide

*AGO v3 · Free Peoples · every figure below is taken from the mod's data files and the compendium (agocompendium.com).*

## At a glance

| | |
|---|---|
| **Leader / Heir** | Steward Denethor II (age 80) / Captain-General Boromir (32) |
| **Capital** | Minas Tirith (huge city) |
| **Starting settlements** | 14 |
| **Starting treasury** | 12,000 — **king's purse 0** (no per-turn stipend) |
| **Roster** | 39 faction units: 23 infantry, 6 cavalry, 10 ranged, plus shared Westron siege (catapult/ballista), the Gondor Trebuchet, and Gondor boats/ships |
| **Smiths** | Armour upgrades to **level 4** (Armourer chain); events extend it to **level 6** |
| **Traits** | Heat resistance +1, cold −1, coastal movement ×1.25 |

Gondor is the classic "broad realm, immediate war" campaign: a large, rich kingdom whose elite heavy infantry is among the best of the Free Peoples, facing Mordor's nine provinces directly across the Anduin.

## Victory conditions

- **Short campaign:** hold Minas Tirith, control 24 regions, outlive **Mordor**.
- **Long campaign:** hold **Minas Tirith, West Osgiliath, East Osgiliath and Minas Morgul**, control 40 regions, outlive **Mordor, Dol Guldur and the Adûnaim**.

Note what this implies: every campaign runs through Osgiliath and ends with the storming of Minas Morgul. Your whole early game should be built around securing that river line.

## Starting position

Your 14 provinces: Minas Tirith, West Osgiliath, Cair Andros, Pelargir, Carathan, Brethil, Annulond, Lond Galen, Calembel, Fanuilond, Morthond, Carasast, Serelond, Tarnost. Only one is a huge city (Minas Tirith); most of the realm is towns and villages with room to grow.

Around you:

- **Mordor (east, 9 provinces)** — holds Minas Morgul, the Morannon, Cirith Ungol and Barad-dûr. Your only real border enemy at the start, and the faction you must outlive.
- **East Osgiliath** — **rebel-held large city (population 800) directly across the river.** Your obvious first conquest; see the questline below.
- **Rohan (north, 10 provinces)** — friendly, strategically vital (see Beacons of Gondor), and your mercenary pool.
- **Dol Amroth (west, 5 provinces)** — a separate friendly faction by default; an AGO.cfg option (`merge_dol_amroth`) annexes it into Gondor at campaign start if you prefer a bigger realm.
- **Khand (5 provinces)** and **Harad (1 far-southern province at start)** — distant for now; Khand sits beyond Mordor to the south-east.

## Opening priorities

1. **Take East Osgiliath immediately.** It is a rebel large city, a long-campaign victory region, a requirement for recruiting Guards of Osgiliath, and holding both halves of Osgiliath gives a 90 %-per-turn chance to spawn **Berethor**, an exiled hero who arrives at West Osgiliath with a unit of Osgiliath Veterans and unique retinue items.
2. **Fortify the river line: West Osgiliath, Cair Andros, Minas Tirith.** These three are the gates Mordor must pass. Cair Andros covers the northern crossing toward Anórien.
3. **Build economy and temples everywhere else.** With a king's purse of 0, all income comes from settlements and trade — and your best units are gated behind **Dúnedain religion** (see below), so temples pay twice.
4. **Use your spy.** You start with Nirven (age 20) — keep him watching the Morannon or Minas Morgul so Mordor's stacks never surprise you.

## Economy, religion and recruitment

**Religion gates.** Gondor's core and elite recruitment requires Dúnedain religion in the settlement: Gondor Infantry/Spearmen/Cavalry need **50 %**, Guards of Osgiliath need **60 % plus an Osgiliath region**, Citadel Guard need **75 %**. A freshly conquered settlement cannot train your real army until conversion catches up — build temples first.

**Fief recruitment.** Ten fiefs — Blackroot Vale, Ithilien, Anórien, Belfalas, Lossarnach, Anfalas, Pinnath Gelin, Lamedon, Lebennin, Ringló — recruit their **own regional units with priority**; generic Gondor units appear only where no fief unit covers the slot. Plan barracks accordingly: Anórien is where Knights of Anorien come from, Belfalas trains the Amrothian line (Talon Knights at 75 % Dúnedain), Lamedon and Lossarnach supply their own infantry.

**Rohan mercenaries.** A dedicated mercenary pool in Rohan's heartlands — maximum availability at Edoras, and also at **Carathan, which you own from turn 1**. Cheap mid-game cavalry to patch your thin stables.

**Smiths.** Armour upgrades reach level 4 normally, level 6 with events — middling for the Free Peoples (the dwarven realms reach 7). Worth building in your recruitment hubs; your elites are armour-stacked already.

## The army

| Unit | Tier | Role | Key numbers |
|---|---|---|---|
| Territorial Guardsmen | Low | Garrison spears | 70 men, free upkeep, light spear vs cavalry |
| Blackroot Vale Archers | Low (fief) | Early archers | Duinhir & Derufin's home unit |
| Gondor Infantry | Mid | Line of battle | atk 7, def 10/5/5, shield wall, 900 g |
| Gondor Spearmen | Mid | Anti-cavalry line | light spear, shield wall, 900 g |
| Gondor Archers | Mid | Foot missiles | missile 5, range 170 |
| Gondor Cavalry | Mid | Shock cavalry | charge 20, formed charge, 1,050 g |
| Knights of Anorien | High (Anórien) | Elite lancers | charge 20, wedge, spear bonus, morale 16 |
| Guards of Osgiliath | High (Osgiliath) | **Armour-piercing** axes | atk 8 AP, phalanx, 1,100 g |
| Citadel Guard | High | Best all-round infantry | atk 11, def 16/9/7, shield wall, **free upkeep**, 1,275 g |
| Fountain Guard | High | Unbreakable anchor | long-pike phalanx, **morale-locked (never routs)**, 1,400 g |
| Osgiliath Veterans | High | Elite archers | missile 6, range 190, can plant **stakes** |

**How to fight with it.** Gondor wins set-piece battles: a shield-wall front of Gondor Infantry/Spearmen, Fountain Guard anchoring the centre (they cannot rout — build the line around them), massed archers behind with Osgiliath Veterans' stakes blunting cavalry, and Knights of Anorien delivering the wedge charge into flanks. Against Mordor's armoured trolls and heavy orcs, bring **Guards of Osgiliath — your armour-piercing answer**.

**What you lack:** horse archers and any ranged cavalry, and only six cavalry units overall. Don't chase skirmishers with knights; let your superior foot archers shoot them out of the field. Your discipline and morale (most elites are *very hardy*, highly trained) mean you win long grinding fights — fight those, not running ones.

## Questlines and scripted events

- **Reclaim Osgiliath** — hold both East and West Osgiliath; high chance per turn of spawning the hero **Berethor** at West Osgiliath with Osgiliath Veterans and unique ancillaries.
- **Beacons of Gondor** — fires automatically at turn 30, 50 or 80, *or the moment Minas Tirith is besieged*; **requires Rohan to hold 5+ settlements including Edoras**. Spawns Rohirrim reinforcement armies near Minas Tirith. This is your safety net — it only exists while Rohan lives.
- **Reunited Kingdom** — can begin randomly after turn 50 (needs Faramir or Boromir alive and Minas Tirith in good hands). Faramir journeys to Rivendell to find Aragorn; completing it requires an **alliance with the Northern Dúnedain** and restores the kingship.
- **Denethor's Madness** — Denethor deteriorates when **Mordor defeats Gondorian armies** or when **Faramir or Boromir dies**. The cure is prevention: don't feed armies to Mordor, don't gamble the brothers.
- **Rohan Mercenaries** — the Edoras/Carathan hiring pools described above.
- **Control Dol Amroth** — the start-of-campaign config choice: vassal-style ally or annexed at start.

## Heroes worth protecting

Eighteen named characters at start, many with scripted battle abilities. The ones that matter most:

- **Boromir** (32, heir, *Boromir's Company*) and **Faramir** (27, *Captain's Rangers*, the best-equipped starting retinue) — the Reunited Kingdom questline and Denethor's sanity both depend on at least one of them staying alive. Treat them as quest items that can swing a battle, not as expendable generals.
- **Denethor** (80, IRON_FIST) — he will not last forever at his age; Boromir is the succession plan.
- **Beregond** (Citadel Guard), **Duinhir** (Blackroot Vale Archers), **Forlong** (Lossarnach), **Angbor** (Lamedon) — regional captains with ability-boosted retinues, ideal as second-line army leaders for their home fiefs.

## Mistakes to avoid

1. **Losing Boromir or Faramir.** It accelerates Denethor's Madness *and* can cost you the Reunited Kingdom questline. Two mechanics punished by one death.
2. **Letting Rohan fall.** Beacons of Gondor needs Rohan alive with 5+ settlements including Edoras. If Rohan collapses, your scripted reinforcements — and your mercenary pool — vanish. Help them if Isengard presses.
3. **Neglecting Dúnedain temples.** 50–75 % religion gates mean conquered land contributes militia, not Citadel Guard, until converted. Temples before barracks in new conquests.
4. **Leaving East Osgiliath rebel.** Every turn it sits unconquered you forgo a large city, a victory region, an elite recruitment site and the Berethor spawn.
5. **Attacking into Mordor early and piecemeal.** Lost battles against Mordor specifically drive Denethor mad. Consolidate, out-economy them (your 14 provinces beat their 9 in the long run, especially with no purse forcing you to grow income), then push through Osgiliath toward Minas Morgul in force.
6. **Ignoring the fief system.** Generic units often can't be trained where a fief unit takes priority. Match your recruitment buildings to each fief's roster instead of expecting Gondor Infantry everywhere.
7. **Floating on the 12,000 starting gold.** With a king's purse of 0, upkeep eats you: elites cost 90–140 per turn each. Garrison cities with free-upkeep Territorial Guardsmen (and Citadel Guard, who are also upkeep-free) and keep field armies few but full.
