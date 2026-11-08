# Userscript change log

The userscripts in this folder are separate from the simulator. Their changes are listed here, never in the simulator's patch notes (`patchNote.json`). Keep each script's `@version` equal to its latest section.

## MWICS Exporter (`mwics-exporter.user.js`)

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
