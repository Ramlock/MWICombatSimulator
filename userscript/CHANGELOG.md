# Userscript change log

The userscripts in this folder are separate from the simulator. Their changes are listed here, never in the simulator's patch notes (`patchNote.json`). Keep each script's `@version` equal to its latest section.

## MWI Combat Tracker (`mwics-exporter.user.js`; called MWICS Exporter up to 0.4.1)

### 0.9.0 (2026-11-09)

- Simpler install: you no longer paste the helper's token. When the script holds no token it asks the helper for it, once when the game page loads (and again at 2 s, 4 s, 8 s and so on, up to 60 s, while it still has none), and stores the answer. The helper hands the token only to a script manager on the same machine; a web page cannot read it. The menu entry **Set helper token** stays as a manual override, and a token you pasted is never replaced. After updating the script, restart the helper once (the helper needs the new `/token` route).
- A warning now shows by itself on the game page, once per page load, when the recorder is on and the script still has no helper token: "MWI Combat Tracker: no helper token, so nothing is sent to the helper. The recording stays in this browser." It goes away when the token arrives. Before, a missing token showed nothing until you opened the Status menu entry.
- The script's name and namespace are unchanged, so an update keeps your settings, your recording and the list of what was already sent.

### 0.8.0 (2026-11-09)

- The party snapshot the simulator page reads now also says which players to tick (the slots of the party) and which zone and tier the group is fighting, and the "Import party from game" button ticks those players and sets that zone and tier (a dungeon switches the dungeon option on first). The zone and tier come from the game's own party and action messages, which the script now also reads (read-only, like the others). Idle, or in the Labyrinth, there is no zone or tier and the page keeps what it has; a zone or tier the page does not offer is left as it is. An older snapshot, or an older simulator page, imports exactly as before.
- "Copy group export" now copies the slots plus `selected` and `fight` as top-level keys beside them (never inside a slot), so the simulator's own paste box can tick the players and set the zone and tier too. Note: the original simulator ignores the extra keys, and an older build of our page (before this change is published) shows two junk players named `selected` and `fight` when such a copy is pasted into it.

### 0.7.3 (2026-11-08)

- The combat recording now keeps every damage hit you and your party deal, not only the totals: when it happened, who dealt it, which ability, which enemy, how much, and whether it hit, missed or crit. Each fight stores them as one short packed text, about 70 KB per hour of fighting (the totals stay as they were). The "own character only" export keeps only your hits. A fight stores at most 20000 hits; any beyond that are counted, not kept. Damage you take is not stored hit by hit yet.
- The party export and the character export now include the trinket slot (the task badge). The simulator does not read that slot yet, so importing it changes nothing there.

### 0.7.2 (2026-11-08)

- Fix in the combat recording: a critical hit is now counted only when the hit did damage. Before, an attack that did no damage but carried the critical flag was counted as a critical hit, which put more crits than hits in some sources. Those events are now kept in a new field `critsOnMiss` next to `crits`, so nothing recorded is lost. Recordings made before this version keep their old crit counts.

### 0.7.1 (2026-11-08)

- No change you can see. Adds two calculation functions for working out how much each damage bonus added to a hit (what the hit loses without that one bonus) and each bonus's even share of the total. Nothing calls them yet and nothing is shown; they will be used once the damage formula is fed from the recording.

### 0.7.0 (2026-11-08)

- A teammate's guild buff levels now come from their shared profile: open the profile in the game, then import or copy the party. The notice names the teammates whose guild buffs came from their profile. This corrects 0.6.1, which said a profile does not carry them. A profile opened before this version holds no guild buffs: open it again.

### 0.6.1 (2026-11-08)

- The notice after a party import or group copy no longer suggests that opening a teammate's profile fills in missing guild buffs: a profile does not carry them. The notice now says to set them in the simulator, and the profile advice names only the missing parts a profile does carry (levels, gear, abilities, triggers, house rooms, achievements).

### 0.6.0 (2026-11-08)

- The per-player colouring was removed at the user's request: damage numbers go back to the game's red, teammates' names go back to plain, and the "Teammate colours" settings and the miss ring are gone. Colours you picked stay in the script's storage, unused.

### 0.5.1 (2026-11-08)

- New default teammate colours, slot 1 to 5: magenta, gold, lime, indigo, brown (best first, since slot 1 is filled most often). Colours you picked yourself stay as they are.
- A miss on an enemy keeps its grey fill and gets a thin ring in the colour of the teammate who missed, when the tracker knows who it was.

### 0.5.0 (2026-11-08)

- Renamed from MWICS Exporter to MWI Combat Tracker. Your script manager sees the new name as a different script: install this version, then remove MWICS Exporter. Settings and the stored combat recording do not carry over, so copy or save the recording from the old script first if you want it.
- New: teammate colours. The damage numbers on enemies are drawn in the colour of the teammate who dealt the hit, and each teammate's name in the combat window is drawn in the same colour. Each party slot has a default colour (never red) until you pick one in Settings, under "Teammate colours"; a picked colour follows that player whatever their slot.
- A hit the tracker cannot tie to one teammate (several hits merged into one number, damage with no known attacker) keeps the game's red. That colour can be picked in Settings too. Critical hits keep their orange glow; misses and heals are not recoloured.
- Display only: it changes what your own page draws, never anything sent to the game.

### 0.4.1 (2026-11-08)

- The "Import party from game" button on the simulator page now sits in its own row with a gap above it, and no longer shifts the Dark Mode toggle.
- The shared-profile fields the group export reads were checked against real profiles; no change was needed.

### 0.4.0 (2026-11-08)

- New menu command "Copy group export (party, for Group Combat import)": copies your whole party in the format of the simulator's Group Combat "All players import". Your own slot is complete. For the others, abilities, food and drinks come from the battle; levels, gear, triggers, house rooms and achievements appear once you open that member's profile in the game. Anything not available is left out, so the simulator keeps its current value for it. Guild buff levels of the others are not available.
- On the simulator page (the fork's site and local copies) the script adds an "Import party from game" button that imports the party straight from the open game tab, with no copy and paste. It refuses when the game tab has not shared a party or the data is more than 30 minutes old.
- Still read-only toward the game.

### 0.3.0 (2026-11-07)

- The combat recording can be written to a file on your own computer while you play, through a small helper program that you run yourself (queue, retry, and a one-time token pasted from the menu).
- New menu command "Save combat recording (file)" downloads the recording as a file, without a helper.
- Menu commands renamed: "Copy character export" (player, gear, inventory), "Copy combat recording" and "Clear recorded combat data".

### 0.2.0 (2026-11-07)

- Records the whole party's combat while you play.
- New menu commands "Copy loot export" and "Clear recorded loot".
- New setting to export only your own character.

### 0.1.1 (2026-11-04)

- The export carries the combat gear slots only.

### 0.1.0 (2026-11-04)

- First version: reads the character data the game sends (read-only), with ten toggles for what to include, and copies the export to the clipboard.

## Guild Chat Export (`mwics-guildchat.user.js`)

### 0.1.0 (2026-11-07)

- First version, optional: saves your guild chat live to a file on your own computer through a small helper program that you run yourself.
- Only reads what the game already shows you, never types in the chat, and does nothing without the helper.
