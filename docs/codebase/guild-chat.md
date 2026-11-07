# Guild chat: how the game delivers it, and a proposed live export

Research and proposal only, nothing is built (2026-11-07). Read from source: no live capture of the game was made, so every message shape below is what the game's own code reads, not what the server was seen to send. Each "unverified" mark is settled by one logged session on a real account. No real chat line, name or party detail is in this document; every example is invented.

## Sources

- The game's client bundle `https://www.milkywayidle.com/static/js/main.8add56c3.chunk.js` (1,959,100 bytes, one minified line, fetched read-only 2026-11-07). A position is written `main@<byte offset>`; read it with `tail -c +<offset+1> main.js | head -c 1500`. The file name changes with every game release, so re-find by the strings named here.
- Toolasha 2.108.4 libraries at commit `4d71f9c5ad5c473c00558c6a7af8f0bafa763032` (`toolasha-ui.js`, fetched from jsDelivr; `toolasha-combat.js` is the copy in the private repo's `docs/ground-truth/third-party/toolasha-2.108.4/`). MWITools 26.4.23 (private repo, same folder).
- Our exporter `userscript/mwics-exporter.user.js` (the read-only hook, lines 179-203) and `game-data-fields.md`.

## 1. How the game delivers guild chat

All of it rides the one game WebSocket (hosts `api.milkywayidle.com/ws`, `api-test.milkywayidle.com/ws`; `userscript/mwics-exporter.user.js:44`). The client dispatches on `message.type` through one table (`main@1915380`).

| Message type | Handler | What it does | Position |
| --- | --- | --- | --- |
| `init_character_data` | login handler | carries `guildChatHistory`, `partyChatHistory`, `whisperChatHistory`, `moderatorChatHistory` (each `\|\| []`) and stores them as the per-channel history | `main@1859977` |
| `chat_message_received` | `handleMessageChatMessageReceived` | `data.message` is appended to the history of channel `message.chan`; the history is cut to the newest `MAX_CHAT_MESSAGE_COUNT` = **100** per channel | `main@1869018`, constant `main@220344` |
| `chat_message_updated` | `handleMessageChatMessageUpdated` | finds the line with the same `id` in that channel's history and replaces it (for a translation update it keeps the old `isDeleted` and `deleteReason`) | `main@1869604`, merge `main@222719` |
| `guild_chat_history_updated` | `handleMessageGuildChatHistoryUpdated` | **replaces the whole guild history** with `data.guildChatHistory` | `main@1885186` |
| `guild_updated` | `handleMessageGuildUpdated` | when `guild` is empty (left or kicked), the guild history is set to `[]` | `main@1885186` (same handler region) |

The client never asks for older history: the only chat request types in the bundle are `send_chat_message`, `delete_chat_message`, `delete_own_chat_message`, `undelete_chat_message`, `report_chat_message`, `update_chat_settings` (and moderator ones). There is no "fetch history" request. So history comes only on login (and on `guild_chat_history_updated`, whose trigger the client does not show: unverified), and live lines come only while the socket is open.

### The line shape

`message` fields the bundle and Toolasha read (a field not in this table was not seen read):

| Field | Meaning | Read at |
| --- | --- | --- |
| `id` | line id, the key the client matches on for updates (`t.id === s[n].id`); numeric or string and monotonic order: **unverified** | `main@1869604` |
| `t` | send time, ISO string (`new Date(t.t)`) | `main` chat row render; `toolasha-combat.js:2209` |
| `chan` | channel hrid, see below | `main@1869018` |
| `cId`, `sName` | sender's character id and name | `main` chat row render |
| `m` | the text. For a system line it is a key such as `systemChatMessage.characterLeveledUp`, not prose | `toolasha-combat.js:2212-2224`; keys at `main@220344` region (`SystemMessages`) |
| `isSystemMessage`, `systemMetadata` | system line flag; `systemMetadata` is a JSON string with the parameters | `toolasha-ui.js:4195-4201` |
| `isModMessage` | moderator line | `main` chat row render |
| `linksMetadata` | JSON string: the item/ability/market/party/guild links inside the text | `toolasha-ui.js:4186-4193` |
| `isDeleted`, `deleteReason` | deletion state, see below | `main@222719` |
| `rId`, `rName` | receiver, whispers only | `main` chat row render |
| `gm`, `specIcon`, `icon`, `color` | display only (game mode, name icon, colour) | `main` chat row render |
| `tr`, `o` | translation map and original text when chat translation is on; with translation on, `m` may be the translated text and `o` the original | `main@222100` region |

Channels (`main@220344`): `/chat_channel_types/` + `general`, `english`, `chinese`, `japanese`, `korean`, `french`, `german`, `spanish`, `portuguese`, `russian`, `vietnamese`, `ironcow`, `trade`, `recruit`, `beginner`, `help`, **`guild`**, `party`, `moderator`, `whisper`. All arrive through the same `chat_message_received` type, so the guild filter is `message.chan === '/chat_channel_types/guild'` (Toolasha filters the party channel the same way: `toolasha-combat.js:2193`).

### What shares the guild channel and must be handled

- **System lines** (`isSystemMessage`): level-ups, community buffs, guild trial schedule and signup, guild building upgrades (`SystemMessages`, `main@220344` region). They are real guild traffic; keep them but tag them (`system: true`), so a watcher can skip them.
- **Moderator lines** (`isModMessage`): keep tagged.
- **Translation** can rewrite `m`: record `m` and, when present, `o`, so the original is never lost. Whether `m` is already the translated text before the user turns translation on is unverified.
- **Other channels** (global languages, trade, recruit, party, whisper, moderator) and **whispers in particular** are other people's private words: the export drops everything that is not guild **inside the page**, before anything is stored or sent.
- **Own lines**: the account's own lines arrive as ordinary `chat_message_received` too (`cId` = own id); keep, tag `own: true` by comparing with the character id from `init_character_data`.

### Deleted and edited lines

There is no separate "deleted" message. A deletion is a line whose `isDeleted` (and `deleteReason`) is set, arriving as a `chat_message_updated` for the same `id` or inside a refreshed `guild_chat_history_updated` (the client renders a deleted line as "[message deleted - reason]" only for moderators (and for the sender of a whisper), and renders nothing for anyone else: `main` chat row render, `if(t.isDeleted){...return null}`). Whether a normal member's client ever receives a deleted line, or just stops receiving it, is **unverified**. No edit feature was found; the only update seen is translation and deletion.

### History on connect, and how far back

`init_character_data.guildChatHistory` is stored as given, with no client-side cut (the 100 cap is applied only when a live line is appended), so the server decides the depth. The depth, whether it is a count or a time window, and whether the same array comes again on a reconnect are **unverified**; the first logged session answers all three.

## 2. What existing scripts do (source only, nothing installed or run)

| Script | Listens to | Keeps | Exports |
| --- | --- | --- | --- |
| Toolasha 2.108.4 pop-out chat (`PopOutChat`, `toolasha-ui.js:4181-4345`) | `chat_message_received`, every channel | in memory, `MAX_BUFFER` = 500 per channel (`:4066`), resolved to `{channel, sName, m, t, isSystem, renderedLinks}`; relays to a pop-out window by `BroadcastChannel` | no |
| Toolasha chat history extender (`ChatHistoryExtender`, `toolasha-ui.js:5444`; setting `chatHistoryExtender_maxHistory` default 150, `toolasha-core.js:727-739`) | the page's DOM (the rendered chat rows), not the socket | the rows the game removes from its 100-line buffer, per tab | no |
| Toolasha party-chat reader (`toolasha-combat.js:2185-2227`, `:1644`) | `chat_message_received`, party channel only | last 100 party lines in memory, for key counts and battle-start times | no |
| MWITools 26.4.23 | no chat socket handler found (the only chat match is a CSS class, line 33328) | nothing | no |
| Greasy Fork search, "MWI chat log export" (2026-11-07) | no MWI chat logger or exporter found; "MWI Chat Translator C->E" (script 533994) translates, "MWI Dungeon Timer" (539918) reads key-count lines; the one chat-log downloader hit (script 11783) is a 2015 Kongregate script | n/a | n/a |

Result: nobody records guild chat to disk. Toolasha proves the `chat_message_received` route works and that the live buffer is memory-only; the extender proves the game's own buffer drops lines (100 per channel).

## 3. Pipeline options

A userscript can read every message (our exporter's `MessageEvent.prototype.data` hook already does, read-only) but cannot append to a file by itself.

| | How | For | Against |
| --- | --- | --- | --- |
| (a) Userscript to a local helper | `GM_xmlhttpRequest` POSTs each new line to `http://127.0.0.1:<port>`; the helper appends to the jsonl and owns the cursor | unattended, append-only, one writer, cursor lives with the file, the helper can be the watcher | one more process to run; a local HTTP port other pages could try to reach |
| (b) File System Access API | `showDirectoryPicker` once; the page appends to a file in the picked folder | no helper | the permission needs a click again after the browser restarts, so it breaks unattended; the handle belongs to the page, not the script manager; Chrome only |
| (c) Periodic downloads | `GM_download` or an anchor download | no helper | no append: a new file per batch, in Downloads, which is not the target folder; duplicates; a download prompt in some setups |
| (d) A script that holds its own game connection | a bot logs in and listens | no browser needed | needs the account's login or session token; **no credential-free way exists** (the socket authenticates with the account's session), a second connection may also kick or flag the first, so it is out |

**Recommendation: (a).** Hardening it needs:

- The helper binds `127.0.0.1` only (never `0.0.0.0`) and checks the `Host` header is `127.0.0.1:<port>` or `localhost:<port>` (stops DNS rebinding).
- A random token (32 bytes) generated by the helper on first run, stored in the helper's own config file and pasted once into the userscript's storage (`GM_setValue`); every request carries it in a header, constant-time compared, and a wrong token gets a 401 and no body. Any other page that guesses the port still cannot write.
- `GM_xmlhttpRequest` is used rather than page `fetch`, so the request is the script manager's, not the game page's (the game page cannot read the token or the helper's replies, and Chrome's local-network-access prompt for page requests to localhost is not triggered). An `Origin` check is added as a second layer only: the helper rejects any request whose `Origin` is a web page other than the script manager's (a missing Origin is accepted, since the token is the real control).
- The helper accepts one endpoint, `POST /v1/lines` (a JSON array, capped at 256 lines and 256 KiB), and one read of the cursor, `GET /v1/cursor`. It has no delete, no listing and no file path in any request. It writes only inside its configured folder.
- Request body is validated: unknown `chan` is dropped, fields are length-capped, anything else rejected.

### File and line format

- A private folder outside every git repo (for the owner to confirm). One file per month, `guild-YYYY-MM.jsonl`, append-only, one JSON object per line, UTF-8, no BOM.
- Every line carries `v` (format version, starts at `1`) and `type`:
  - `{"v":1,"type":"msg","id":"<game id>","t":"<game ISO time>","sName":"Example","cId":123,"m":"hello","o":null,"system":false,"mod":false,"own":false,"links":[],"seen":"<local ISO time>","src":"live"}` where `src` is `live` or `history`.
  - `{"v":1,"type":"update","id":"<game id>","isDeleted":true,"deleteReason":null,"seen":"..."}` for a `chat_message_updated` or a deletion found by diffing a refreshed history.
  - `{"v":1,"type":"gap","from":"<last known t>","to":"<oldest t the history now holds>","seen":"..."}`, see the cursor below.
  - `{"v":1,"type":"session","event":"start|end","seen":"..."}`, written when the tab connects and when it goes away (best effort), so a quiet hour reads as "tab closed" or "no chat", not as a gap.
- `m` is stored as received, never altered. Raw `systemMetadata`/`linksMetadata` strings are kept in `meta` when present.

### The cursor: "always from the last message it knew of"

- The helper holds the cursor: `{id, t}` of the newest guild line it wrote, in `state\cursor.json` beside the helper (ids and times only, never text; the state file is saved to a temp file, flushed, then swapped, with a `.bak`, as a typical chat watcher does).
- On every connect the script reads `init_character_data.guildChatHistory`, asks `GET /v1/cursor`, and sends only the lines **after** the cursor (by position of the cursor's `id` in the array, falling back to `t` if the id is not found). The same dedupe applies to a `guild_chat_history_updated` array and to a reconnect. The helper also drops any `id` it already holds (a small set of the last 1,000 ids, rebuilt from the file's tail at start), so a repeated history cannot double-write.
- **After the tab was closed for an hour:** the next connect brings the history. If the cursor's line is inside it, everything after it is written with `src:"history"` and no gap. If the history's oldest line is newer than the cursor, the lines between are not obtainable (the client cannot ask for older chat): the helper writes one `gap` line `{from: cursor t, to: oldest t in the history}` and then the lines. The first-ever run has no cursor: it writes the history as `history` lines and marks a `gap` from nothing; the watcher (below) hands over none of it.
- A line older than the cursor's `t` that appears later (a late arrival) is written once if its `id` is new, tagged `late:true`.

### The watcher

- A watcher script (not built; it would live with the helper, outside this repo), modelled on a chat-tail watcher that hands a session each new line once from a saved cursor: each run is one drain, reads the jsonl from its own saved cursor, hands the new `msg` lines to the recipient as **one session message per drain**, and advances its cursor **only after the send succeeded**. State holds ids and byte offsets only, never text, git-ignored, with `.bak` recovery. Delete the state and the next run hands over nothing old. `gap` and `session` lines are handed over only as a one-line count ("1 gap, 2 hours"), `update` lines only when they delete a line already handed over.
- The recipient is the owner's choice (question 1). A drain should skip `system` lines and the account's own lines by default (question 4).

### Read-only guarantees

- The userscript only reads `MessageEvent.data` through the same chained getter as the exporter. It never calls `WebSocket.send`, never fires any chat request type, touches no DOM input, no login, no token and no cookie. It stores its own helper token and nothing else.
- It filters to the guild channel inside the page: other channels, whispers included, never reach the helper.
- The helper has no outbound network access of its own and no route that reads a file back to the page except the cursor.
- A test greps the userscript source for `.send(`, `send_chat_message`, `localStorage`, `document.cookie` and fails the build on any of them.

### What breaks it

- The game changes the message type names or the `chan` hrid (the filter then writes nothing; the helper reports "no line for N minutes while a session is open", the watcher says so once).
- The server's history depth is shorter than the gap: lines are lost, marked by `gap`, never invented.
- The tab is closed or asleep: nothing is recorded live; the next connect covers it as above, up to the history depth.
- The helper is not running: the userscript queues up to 1,000 lines in memory and retries; past that it drops the oldest and the next cursor read creates a `gap`.
- Script managers that block `GM_xmlhttpRequest` to localhost (a connect-permission prompt appears on first use and must be accepted once: `@connect 127.0.0.1`).
- Chat translation on: `m` may be the translation; `o` is kept when present, so a check for `o` is part of the first logged session.
- The game's multi-tab behaviour: two tabs would both send; the helper's id dedupe makes that harmless.

## 4. Open questions (as asked in batch 1; the answers are in section 5)

1. **Recipient of the drain.** Recommendation: the owner's coordinating session, which routes to whoever needs it.
2. **Folder.** Recommendation: a private folder outside every repo, as above (needs a granted private folder).
3. **Retention.** Other people's words sit on disk indefinitely. Recommendation: monthly files, keep 12 months, then delete; the helper does not prune, a separate command does, run by the owner.
4. **What a drain hands over.** Recommendation: other people's non-system lines only; the account's own lines and system lines stay in the file but are not handed over.
5. **Is a first live capture allowed?** Every "unverified" above is settled by one real session with a throwaway logging build (the exporter plus a `console.log` of the guild channel's raw messages, to the browser console only, nothing stored). Recommendation: yes, before any build, and the owner reads the console themself since the content is other people's words.
6. **The helper's language and where it lives.** Recommendation: PowerShell 5.1 `HttpListener` (no install, same as the other project tools), source kept with the owner's private tools, run by a scheduled task or a long-lived loop.

## 5. As built (batch 2, 2026-11-07)

Built: the userscript `userscript/mwics-guildchat.user.js` (tests: `userscript/test/guildchat.test.cjs`, run `node userscript/test/guildchat.test.cjs`) and a reference helper (PowerShell 5.1 `HttpListener`, kept in the owner's private repo, so not in this fork). Not built: the watcher that hands lines to a session; nothing reads the file yet. Nothing is deleted or pruned: the file keeps every line, system and own lines included.

Where the build differs from or fixes the proposal above:

- The **userscript** writes the `gap` line (it sees the history array and the helper's cursor), not the helper. The helper accepts four line types (`msg`, `update`, `gap`, `session`), drops unknown fields, clips text at 4,000 characters and refuses a bad `v`, `type`, time or `src`.
- Wire protocol: `POST /v1/lines` with a JSON array (at most 256 lines, 256 KiB; over either is `413`, a non-array is `400`) and `GET /v1/cursor` (`{"id","t"}` or `{}`); header `X-MWI-Token`; `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (else `403`); a wrong or missing token is `401` with no body. An `Origin` is accepted when absent, from a script manager's extension scheme, or from the game's own pages; any other web page is `403`. No CORS headers are ever sent. Default port `47631`, bound to `127.0.0.1` only.
- The helper dedupes `msg` ids against the last 1,000 (rebuilt from the file's tail on start), flags a line older than the cursor `late:true`, and writes `update` deletions once per id. The cursor (newest `msg` by time) is saved after every batch to a state file next to the chat file (ids and times only; temp file, flush, swap, `.bak`), and rebuilt from the file tail if both are unreadable.
- The helper's log carries a timestamp, route, status and counts only; no message text or sender name ever enters the log or the state file.
- The userscript queues up to 1,000 lines while the helper is unreachable, retries with backoff (2 s doubling to 60 s), and past the cap drops the oldest and writes one `gap` line once the helper is back. One toast tells the user when the helper is unreachable or the token is wrong.
- Read-only: a test greps the userscript source (comments excluded) for a socket `.send(`, the chat request types, `new WebSocket`, `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB`, `dispatchEvent`, `click()` and for any network host other than the local helper, and fails on any.
- Still unverified until the first real session: history depth, id type and order, `o` when translation is on, whether a normal member ever receives a deleted line, and whether the script manager sends an `Origin` (the helper accepts both cases).

### Install (five steps)

1. Install `mwics-guildchat.user.js` in Tampermonkey (open the raw file) and accept the `@connect 127.0.0.1` prompt on first use.
2. Run the helper's start script once; it prints a token (shown once) and starts listening.
3. In the game tab: Tampermonkey menu, MWICS Guild Chat Export, Set helper token, paste it.
4. Reload the game tab.
5. Done: lines appear in the helper's folder as `guild-YYYY-MM.jsonl`; the menu's Status entry shows live, sent and queued counts.
