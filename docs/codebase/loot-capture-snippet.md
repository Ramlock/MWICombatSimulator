# Loot capture snippet

A small read-only script you paste into the browser console of a logged-in game tab. It listens to the game's WebSocket messages, keeps the combat ones in memory, and on your command saves them to a JSON file you can send us. It is for checking the format proposed in `toolasha-loot-tracker.md` against real messages before anything is built.

What it does and does not do:

- It reads messages the page has already received, through the same `MessageEvent.prototype.data` getter that the exporter, MWITools and Toolasha use. It hands every message on unchanged.
- It sends nothing: no `fetch`, no `XMLHttpRequest`, no `WebSocket.send`, nothing to any server. The only output is a file your browser downloads when you call `save()`.
- It does not read, store or touch your login, token, password, cookies or local storage. It does not press anything in the game.
- It keeps nothing after you close or reload the tab, and writes nothing to disk except the file you save.

## What it records

The raw payload of each of these message types, with a millisecond timestamp:

| Type | Why |
| --- | --- |
| `new_battle` | monsters, players, running loot (`totalLootMap`), drop modifiers, party size |
| `battle_updated` | per-tick monster HP, which is where kills can be counted |
| `loot_log_updated` | the game's Loot Log |
| `actions_updated`, `new_character_action` | which zone and difficulty tier you are fighting |
| `action_completed` | only its `endCharacterAction` (zone, tier); the rest of that message (inventory, skills, items) is **not** kept |
| `battle_consumable_ability_updated` | food and drink use |

The file also holds `typeCensus`: how many messages of **every** type arrived (the type name and a count, no content), so we can see which message types exist that the snippet does not record.

`new_battle` carries the names and character ids of every party member and your own combat stats. The file is for sharing with us; read it first if you want to check.

## Steps

1. Log in to the game as usual and open the game tab (`www.milkywayidle.com`). Start fighting in the zone you want to test, or be ready to start one. Reloading the page is not needed and would stop the capture.
2. Open the browser console: press `F12` (Chrome, Edge or Firefox), then the **Console** tab. In Firefox, type `allow pasting` and press Enter first if it asks.
3. Copy the whole code block below, paste it into the console and press Enter. It prints `[mwics-capture] recording ...`. Pasting it twice does nothing the second time.
4. Fight for as long as you comfortably can (30 minutes or more is a real data run; a few minutes only checks the format). A longer run is more useful because what we need to see only happens over time: a change of zone or difficulty tier, a buff or coffee running out and being renewed, a party member joining or leaving, a death. While it records, open the **Loot Log** panel once, and change zone once if you can (stop combat, pick another zone or tier, start again). Check progress any time by typing `mwicsCapture.status()`.
5. To finish, type `mwicsCapture.save()` and press Enter. Your browser downloads `mwics-loot-capture-<date>.json` to its normal download folder (usually `Downloads`). To stop recording without saving, type `mwicsCapture.stop()`; `mwicsCapture.clear()` empties what was recorded.
6. Send us the file. It stops recording on its own at 40 MB, which is about two hours of combat.

```js
(() => {
    'use strict';
    if (window.mwicsCapture) { console.log('[mwics-capture] already installed:', window.mwicsCapture.status()); return; }

    const TYPES = new Set(['new_battle', 'battle_updated', 'loot_log_updated', 'actions_updated', 'new_character_action', 'action_completed', 'battle_consumable_ability_updated']);
    const MAX_CHARS = 40 * 1024 * 1024;
    const startedAt = new Date().toISOString();
    const seen = new WeakSet();
    let recording = true;
    let chars = 0;
    let parts = [];
    const counts = {};
    const census = {}; // how many messages of every type arrived (no payloads), to find message types we do not know about

    // Reads the message the page already received. Never sends, never changes what the page gets.
    const proto = MessageEvent.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'data');
    const previousGet = desc.get;
    desc.get = function mwicsCaptureGet() {
        const message = previousGet.call(this);
        try {
            if (recording && typeof message === 'string' && !seen.has(this)) {
                const url = String((this.currentTarget && this.currentTarget.url) || '');
                if (url.includes('milkywayidle') && url.includes('/ws')) {
                    seen.add(this);
                    const m = /"type"\s*:\s*"([a-z_]+)"/.exec(message);
                    if (m && (census[m[1]] || Object.keys(census).length < 200)) census[m[1]] = (census[m[1]] || 0) + 1;
                    if (m && TYPES.has(m[1])) {
                        let raw = message;
                        if (m[1] === 'action_completed') {
                            const obj = JSON.parse(message);
                            raw = JSON.stringify({ type: obj.type, endCharacterAction: obj.endCharacterAction || null });
                        }
                        const piece = '{"t":' + Date.now() + ',"type":"' + m[1] + '","payload":' + raw + '}';
                        if (chars + piece.length > MAX_CHARS) {
                            recording = false;
                            console.warn('[mwics-capture] size limit reached, recording stopped. Call mwicsCapture.save().');
                        } else {
                            parts.push(piece);
                            chars += piece.length;
                            counts[m[1]] = (counts[m[1]] || 0) + 1;
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[mwics-capture] read failed', e);
        }
        return message;
    };
    Object.defineProperty(proto, 'data', desc);

    window.mwicsCapture = {
        status: () => ({ recording, messages: parts.length, megabytes: +(chars / 1048576).toFixed(2), counts: { ...counts }, typeCensus: { ...census } }),
        stop: () => { recording = false; return window.mwicsCapture.status(); },
        clear: () => { parts = []; chars = 0; for (const k of Object.keys(counts)) delete counts[k]; for (const k of Object.keys(census)) delete census[k]; return window.mwicsCapture.status(); },
        save: () => {
            const head = '{"format":"mwics-loot-capture","version":1,"startedAt":"' + startedAt + '","savedAt":"' + new Date().toISOString() + '","counts":' + JSON.stringify(counts) + ',"typeCensus":' + JSON.stringify(census) + ',"messages":[';
            const blob = new Blob([head, parts.join(','), ']}'], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'mwics-loot-capture-' + startedAt.slice(0, 10) + '.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            return window.mwicsCapture.status();
        },
    };
    console.log('[mwics-capture] recording ' + [...TYPES].join(', ') + '. Fight for a few minutes, then run mwicsCapture.save()');
})();
```

## Tested and not tested

Tested (`node userscript/test/loot-capture-snippet.test.cjs`, which runs the code block above against a mocked `MessageEvent`, socket, `document` and `Blob`): it chains the previous getter and returns every message unchanged; records only the listed types; trims `action_completed` to `endCharacterAction`; ignores messages from other sockets; sees a message once however many times `data` is read; refuses a second install; stops at the size limit; `save()` makes valid JSON whose payloads equal the originals; it calls no `fetch`, `XMLHttpRequest` or `WebSocket.send`.

Tested on the real game by one player (first capture, 2026-11-07): the URL filter and `currentTarget.url` worked, the page was unaffected, the file saved and parsed, and a few minutes of combat was about 1 MB. The type census was added after that run and has only the mock test.

Not tested: coexistence with Toolasha and MWITools running in the same tab (the same chaining pattern the exporter already uses; which userscripts the first player had installed is not known); a run longer than a few minutes (the 40 MB limit is an estimate from the first capture's rate); and the type census on the real game.
