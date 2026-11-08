# Userscript change log

The userscripts in this folder are separate from the simulator. Their changes are listed here, never in the simulator's patch notes (`patchNote.json`). Keep each script's `@version` equal to its latest section.

## MWICS Exporter (`mwics-exporter.user.js`)

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
