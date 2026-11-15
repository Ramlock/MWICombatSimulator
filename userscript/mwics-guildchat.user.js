// ==UserScript==
// @name         MWICS Guild Chat Export
// @namespace    https://github.com/Ramlock/MWICombatSimulator
// @version      0.2.0
// @description  Read-only live export of your own guild and party chat to a small local helper (127.0.0.1) that appends it to a file. Sends nothing to the game server, types nothing in the chat, never touches the login. Design: docs/codebase/guild-chat.md.
// @author       Ramlock
// @license      CC-BY-NC-SA-4.0
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @downloadURL  https://raw.githubusercontent.com/Ramlock/MWICombatSimulator/main/userscript/mwics-guildchat.user.js
// @updateURL    https://raw.githubusercontent.com/Ramlock/MWICombatSimulator/main/userscript/mwics-guildchat.user.js
// ==/UserScript==

// Attribution (CC-BY-NC-SA-4.0, shared alike): the read-only MessageEvent.prototype.data hook and the game socket hosts are
// MWITools by bot7420, shykai and Stella (https://greasyfork.org/en/scripts/494467), version 26.4.23, reworked here (same hook as
// mwics-exporter.user.js).
// Guarantees: it only reads messages the page already received. It never calls the socket's send, never issues a chat request, never
// reads cookies or page storage, and sends only the kept channels' lines (guild and party, KEPT_CHANNELS); every other channel, whispers
// included, is dropped in the page.

(function () {
    'use strict';

    // The kept channels, as data: every kept channel goes through the same code. chan: the short name each line carries and the helper files
    // it under; hrid: the game's channel; history: the init_character_data field holding its history; refresh: the message type that replaces
    // its whole history, if any (the game has none for the party channel). Docs: docs/codebase/guild-chat.md, "Channels".
    const KEPT_CHANNELS = [
        { chan: 'guild', hrid: '/chat_channel_types/guild', history: 'guildChatHistory', refresh: 'guild_chat_history_updated' },
        { chan: 'party', hrid: '/chat_channel_types/party', history: 'partyChatHistory', refresh: null },
    ];
    const CHAN_BY_HRID = new Map(KEPT_CHANNELS.map((k) => [k.hrid, k.chan]));
    const HRID_BY_CHAN = new Map(KEPT_CHANNELS.map((k) => [k.chan, k.hrid]));
    const REFRESH_BY_TYPE = new Map(KEPT_CHANNELS.filter((k) => k.refresh).map((k) => [k.refresh, k]));
    // A helper from before 0.2.0 files every line as guild, so a line of another channel is sent only once the helper has said it takes it.
    const LEGACY_CHANS = ['guild'];
    const GUILD_CHAN = HRID_BY_CHAN.get('guild');
    const GAME_SOCKET_HOSTS = ['api.milkywayidle.com/ws', 'api-test.milkywayidle.com/ws'];
    const WATCHED_TYPES = new Set(['init_character_data', 'chat_message_received', 'chat_message_updated', ...REFRESH_BY_TYPE.keys()]);
    const FORMAT_VERSION = 1;
    const MAX_BATCH_LINES = 256;
    const MAX_BATCH_BYTES = 200 * 1024; // under the helper's 256 KiB cap, with room for the envelope
    const MAX_QUEUE = 1000;
    const MAX_KNOWN_IDS = 5000;
    const RETRY_MIN_MS = 2000;
    const RETRY_MAX_MS = 60000;
    const MAX_TEXT = 4000;

    function iso(d) { return new Date(d).toISOString(); }

    // The text of a line is stored as received; only a runaway length is cut (the helper has the same cap).
    function clip(s) { return typeof s === 'string' && s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s; }

    // Pure: one game chat message -> one 'msg' line of the file (docs/codebase/guild-chat.md, "File and line format").
    function toMsgLine(message, ownId, src, seen, chan) {
        const line = {
            v: FORMAT_VERSION,
            type: 'msg',
            chan,
            id: String(message.id),
            t: message.t,
            sName: message.sName ?? null,
            cId: message.cId ?? null,
            m: clip(message.m ?? ''),
            o: message.o === undefined ? null : clip(message.o),
            system: !!message.isSystemMessage,
            mod: !!message.isModMessage,
            own: ownId !== null && message.cId === ownId,
            links: [],
            seen,
            src,
        };
        if (message.isDeleted) { line.isDeleted = true; line.deleteReason = message.deleteReason ?? null; }
        const meta = {};
        if (message.systemMetadata) meta.system = message.systemMetadata;
        if (message.linksMetadata) meta.links = message.linksMetadata;
        if (meta.system || meta.links) line.meta = meta;
        return line;
    }

    function toUpdateLine(message, seen, chan) {
        return { v: FORMAT_VERSION, type: 'update', chan, id: String(message.id), isDeleted: !!message.isDeleted, deleteReason: message.deleteReason ?? null, seen };
    }

    // The key of a line in the page's known map: ids are kept per channel.
    function keyOf(chan, id) { return chan + ':' + String(id); }

    // Pure: which lines of one channel's history array still need sending, given that channel's helper cursor ({id, t} or null) and what
    // this page has sent. A cursor found in the history sends what follows it; a cursor not found sends the whole history (never skip). 'connect' also decides the gap line; a 'refresh' (guild_chat_history_updated) only skips what is already known.
    function planHistory(history, cursor, known, mode, chan = 'guild') {
        const hrid = HRID_BY_CHAN.get(chan);
        const list = Array.isArray(history) ? history.filter((m) => m && m.chan === hrid && m.id !== undefined && m.id !== null) : [];
        const out = { fresh: [], gap: null, updates: [] };
        let start = 0;
        if (mode === 'connect' && cursor) {
            const at = list.findIndex((m) => String(m.id) === String(cursor.id));
            if (at >= 0) start = at + 1;
            else {
                // Never skip (2026-11-15): the marker is not in this history, so the whole history is sent and the helper drops the lines it
                // already has. The gap line still says lines may be missing when the oldest line here is newer than the marker.
                start = 0;
                const ct = Date.parse(cursor.t);
                if (list.length && Date.parse(list[0].t) > ct) out.gap = { from: cursor.t, to: list[0].t };
            }
        } else if (mode === 'connect' && list.length) {
            out.gap = { from: null, to: list[0].t };
        }
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            const id = keyOf(chan, m.id);
            if (known.has(id)) {
                if (known.get(id) !== !!m.isDeleted && m.isDeleted) out.updates.push(m);
                continue;
            }
            if (i >= start) out.fresh.push(m);
        }
        return out;
    }

    // The recorder owns the queue, the dedupe and the retry. It talks to the outside only through deps:
    //   post(lines) -> Promise<{ok, status}>, getCursor() -> Promise<{id, t}|null>, now() -> ms, setTimer(fn, ms), log(text) (counts only).
    // A message is handled the moment it is read: it is stamped and queued at once, and never waits for a send to the helper. The one send
    // in flight takes everything queued since the last one, so a slow helper round trip (a background tab the browser throttles) makes the
    // batches bigger, never the backlog longer. While a connect reads the helper's cursor nothing is sent (a live line written first would
    // move the cursor past the lines the history must fill); the history's lines then go in ahead of the live lines that came meanwhile.
    function createRecorder(deps) {
        const state = {
            ownId: null,
            server: 'live', // 'live' or 'test': the game server of the socket the init came from
            known: new Map(), // keyOf(chan, id) -> isDeleted, lines this page has queued or sent
            queue: [],
            dropped: new Map(), // chan -> {from, to} of lines dropped because the helper was unreachable too long
            accepts: null, // the channels the helper takes (a Set), or null until a helper reply has said
            retryMs: RETRY_MIN_MS,
            flushing: false,
            running: Promise.resolve(), // the send in progress
            timerSet: false,
            sessionOpen: false,
            hold: 0, // connects still reading the cursor: nothing is sent while above 0
            holdAt: 0, // where the history of the pending connect goes in the queue
            syncTail: Promise.resolve(), // connects are planned one after the other
            stats: { received: 0, queued: 0, sent: 0, dropped: 0, failed: 0, refused: 0 },
        };
        const stamp = () => iso(deps.now());

        function remember(key, deleted) {
            state.known.set(key, deleted);
            if (state.known.size > MAX_KNOWN_IDS) state.known.delete(state.known.keys().next().value);
        }

        // Whether a line of this channel may be sent now: guild always (every helper takes it); another channel once the helper said so.
        function sendable(chan) { return chan === 'guild' || (state.accepts !== null && state.accepts.has(chan)); }

        // A helper reply says which channels it takes: a list from a 0.2.0 helper, none (null) from an older one, which files all as guild.
        // Lines of a channel it does not take are dropped from the queue (they stay on the page and come back with the next connect's history).
        function learnHelper(chans) {
            state.accepts = new Set(Array.isArray(chans) ? chans : LEGACY_CHANS);
            const keep = [];
            const holdAt = state.holdAt;
            for (let i = 0; i < state.queue.length; i++) {
                const l = state.queue[i];
                if (sendable(l.chan)) { keep.push(l); continue; }
                if (state.hold && i < holdAt) state.holdAt--; // the pending history still goes in where the hold began
                state.stats.refused++;
                if (l.id !== undefined && l.type === 'msg') state.known.delete(keyOf(l.chan, l.id));
            }
            state.queue = keep;
            for (const chan of [...state.dropped.keys()]) if (!sendable(chan)) state.dropped.delete(chan);
        }

        function trim() {
            while (state.queue.length > MAX_QUEUE) {
                const lost = state.queue.shift();
                if (state.hold && state.holdAt > 0) state.holdAt--;
                state.stats.dropped++;
                const at = lost.t || lost.seen;
                const was = state.dropped.get(lost.chan);
                state.dropped.set(lost.chan, was ? { from: was.from, to: at } : { from: at, to: at });
            }
        }

        // Every line says the server and the character it was read on, so the helper can keep only the ones it records.
        function tag(line) {
            line.server = state.server;
            line.character = state.ownId === null ? null : String(state.ownId);
            return line;
        }

        function enqueue(line) {
            state.queue.push(tag(line));
            state.stats.queued++;
            trim();
        }

        // The next batch: the gap lines of the channels that lost lines, then the queued lines in order, skipping a line of a channel the
        // helper has not yet said it takes (it waits for the helper's first reply).
        function nextBatch() {
            const lines = [];
            const picked = new Set();
            const gaps = [];
            let bytes = 2;
            for (const [chan, d] of state.dropped) {
                if (!sendable(chan)) continue;
                lines.push(tag({ v: FORMAT_VERSION, type: 'gap', chan, from: d.from, to: d.to, seen: stamp() }));
                gaps.push(chan);
                bytes += 170;
            }
            for (const l of state.queue) {
                if (!sendable(l.chan)) continue;
                const size = JSON.stringify(l).length + 1;
                if (lines.length >= MAX_BATCH_LINES || (lines.length && bytes + size > MAX_BATCH_BYTES)) break;
                lines.push(l);
                picked.add(l);
                bytes += size;
            }
            return { lines, picked, gaps };
        }

        // Starts a send of what is queued, unless one is running (that one takes the new lines in its next batch) or a connect holds sending.
        // Returns the running send, so a caller may wait for it; no message handler does.
        function flush() {
            if (state.hold) return Promise.resolve();
            if (state.flushing) return state.running;
            state.flushing = true;
            state.running = (async () => {
                try {
                    while (!state.hold && (state.queue.length || state.dropped.size)) {
                        const { lines, picked, gaps } = nextBatch();
                        if (!lines.length) return; // only lines waiting for the helper to say it takes their channel
                        let res;
                        try { res = await deps.post(lines); } catch { res = { ok: false, status: 0 }; }
                        if (!res || !res.ok) {
                            state.stats.failed++;
                            deps.log('send failed status=' + (res ? res.status : 'none') + ' queued=' + state.queue.length);
                            scheduleRetry();
                            return;
                        }
                        state.queue = state.queue.filter((l) => !picked.has(l));
                        for (const chan of gaps) state.dropped.delete(chan);
                        state.stats.sent += lines.length;
                        state.retryMs = RETRY_MIN_MS;
                        learnHelper(res.chans);
                    }
                } finally {
                    state.flushing = false;
                }
            })();
            return state.running;
        }

        function scheduleRetry() {
            if (state.timerSet) return;
            state.timerSet = true;
            const wait = state.retryMs;
            state.retryMs = Math.min(state.retryMs * 2, RETRY_MAX_MS);
            deps.setTimer(() => { state.timerSet = false; flush(); }, wait);
        }

        // One session line per kept channel, so each channel's file shows where a page session began and ended.
        function startSession() {
            if (state.sessionOpen) return;
            state.sessionOpen = true;
            const seen = stamp();
            for (const k of KEPT_CHANNELS) enqueue({ v: FORMAT_VERSION, type: 'session', chan: k.chan, event: 'start', seen });
        }

        function endSession() {
            if (!state.sessionOpen) return Promise.resolve();
            state.sessionOpen = false;
            const seen = stamp();
            for (const k of KEPT_CHANNELS) state.queue.push(tag({ v: FORMAT_VERSION, type: 'session', chan: k.chan, event: 'end', seen }));
            return flush();
        }

        // The lines one channel's history array adds (gap, msg, update), each id remembered as it is planned.
        function planLines(history, cursor, mode, chan) {
            const plan = planHistory(history, cursor, state.known, mode, chan);
            const seen = stamp();
            const lines = [];
            if (plan.gap) lines.push({ v: FORMAT_VERSION, type: 'gap', chan, from: plan.gap.from, to: plan.gap.to, seen });
            for (const m of plan.fresh) {
                lines.push(toMsgLine(m, state.ownId, 'history', seen, chan));
                remember(keyOf(chan, m.id), !!m.isDeleted);
            }
            for (const m of plan.updates) {
                lines.push(toUpdateLine(m, seen, chan));
                remember(keyOf(chan, m.id), true);
            }
            deps.log('history chan=' + chan + ' mode=' + mode + ' lines=' + (Array.isArray(history) ? history.length : 0) + ' fresh=' + plan.fresh.length + ' updates=' + plan.updates.length + ' gap=' + (plan.gap ? 'yes' : 'no') + ' cursor=' + (cursor ? 'yes' : 'no'));
            return lines;
        }

        // The helper's cursor reply, per channel. A 0.2.0 helper answers {id, t, chans: {guild: {id, t} | {}, party: ...}} (id and t are the
        // guild's, for older scripts); an older helper answers {id, t} or {} (guild only). null: the read failed, nothing is known.
        function readCursors(reply) {
            const cursors = new Map();
            if (!reply || typeof reply !== 'object') return cursors;
            const one = (c) => (c && c.id !== undefined && c.id !== null ? { id: c.id, t: c.t } : null);
            if (reply.chans && typeof reply.chans === 'object' && !Array.isArray(reply.chans)) {
                for (const [chan, c] of Object.entries(reply.chans)) cursors.set(chan, one(c));
                learnHelper(Object.keys(reply.chans));
            } else {
                cursors.set('guild', one(reply));
                learnHelper(null);
            }
            return cursors;
        }

        // A connect: sending holds until the cursors are read, every kept channel's history goes in where the hold began, then sending resumes.
        function syncConnect(obj) {
            if (state.hold++ === 0) state.holdAt = state.queue.length;
            state.syncTail = state.syncTail.then(async () => {
                let reply = null;
                try { reply = await deps.getCursor(); } catch { reply = null; }
                try {
                    const cursors = readCursors(reply);
                    for (const k of KEPT_CHANNELS) {
                        const lines = planLines(obj[k.history] || [], cursors.get(k.chan) || null, 'connect', k.chan);
                        state.queue.splice(state.holdAt, 0, ...lines.map(tag));
                        state.holdAt += lines.length;
                        state.stats.queued += lines.length;
                    }
                    if (state.accepts) learnHelper([...state.accepts]); // drops history lines of a channel the helper does not take
                    trim();
                } catch (e) {
                    deps.log('history error ' + (e && e.message));
                }
            }).finally(() => { if (--state.hold === 0) flush(); });
            return state.syncTail;
        }

        // Synchronous: a message is stamped and queued when it is read; the send is started, never waited for.
        function handle(obj, server) {
            if (!obj || typeof obj !== 'object') return;
            const refresh = REFRESH_BY_TYPE.get(obj.type);
            if (refresh) {
                for (const l of planLines(obj[refresh.history] || [], null, 'refresh', refresh.chan)) enqueue(l);
                flush();
                return;
            }
            switch (obj.type) {
                case 'init_character_data': {
                    state.ownId = obj.character && obj.character.id !== undefined ? obj.character.id : null;
                    state.server = server === 'test' ? 'test' : 'live';
                    startSession();
                    syncConnect(obj);
                    return;
                }
                case 'chat_message_received': {
                    const m = obj.message;
                    const chan = m ? CHAN_BY_HRID.get(m.chan) : undefined;
                    if (!chan || m.id === undefined || m.id === null) return; // every other channel is dropped here
                    if (state.accepts !== null && !sendable(chan)) return; // the helper does not take this channel
                    state.stats.received++;
                    const key = keyOf(chan, m.id);
                    if (state.known.has(key)) return;
                    enqueue(toMsgLine(m, state.ownId, 'live', stamp(), chan));
                    remember(key, !!m.isDeleted);
                    break;
                }
                case 'chat_message_updated': {
                    const m = obj.message;
                    const chan = m ? CHAN_BY_HRID.get(m.chan) : undefined;
                    if (!chan || m.id === undefined || m.id === null) return;
                    if (state.accepts !== null && !sendable(chan)) return;
                    const key = keyOf(chan, m.id);
                    if (!(m.isDeleted && state.known.get(key) !== true)) return;
                    enqueue(toUpdateLine(m, stamp(), chan));
                    remember(key, true);
                    break;
                }
                default:
                    return;
            }
            flush();
        }

        // Resolves once every pending connect is planned and the send it started has finished (or failed and scheduled its retry).
        function idle() {
            return state.syncTail.then(() => state.running);
        }

        // Handles the message at once; the returned promise is for callers that want to wait until it is sent (tests). The page does not wait.
        // server: 'live' or 'test', the game server of the socket the message came from (default 'live').
        function push(obj, server) {
            try { handle(obj, server); } catch (e) { deps.log('handler error ' + (e && e.message)); }
            return idle();
        }

        return { push, endSession, state, flush, idle };
    }

    // Cheap type check on the raw frame so only the watched kinds are ever parsed: '{"type":"xxx",...'.
    function frameType(raw) {
        if (typeof raw !== 'string' || !raw.startsWith('{"type":"')) return null;
        const end = raw.indexOf('"', 9);
        return end < 0 ? null : raw.slice(9, end);
    }

    function parseFrame(raw) {
        const type = frameType(raw);
        if (!type || !WATCHED_TYPES.has(type)) return null;
        try { return JSON.parse(raw); } catch { return null; }
    }

    // A request whose callback never comes (the script manager lost it) would stop every later send for good: after ms with no callback
    // it counts as failed (status 0) and the recorder's retry takes over; a late callback is ignored. start(done) issues the request.
    const REQUEST_WATCHDOG_MS = 30000;
    function guardRequest(start, ms, setTimer) {
        return new Promise((resolve) => {
            let settled = false;
            const done = (r) => { if (!settled) { settled = true; resolve(r); } };
            setTimer(() => done({ ok: false, status: 0, timedOut: true }), ms);
            try { start(done); } catch { done({ ok: false, status: 0 }); }
        });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { guardRequest, REQUEST_WATCHDOG_MS, createRecorder, planHistory, toMsgLine, toUpdateLine, frameType, parseFrame, GUILD_CHAN, KEPT_CHANNELS, MAX_QUEUE, MAX_BATCH_LINES, GAME_SOCKET_HOSTS };
        return;
    }

    // ---- Browser part ----
    const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const DEFAULT_URL = 'http://127.0.0.1:47631';
    const seenEvents = new WeakSet();
    let toastShown = false;

    function helperUrl() { return String(GM_getValue('helperUrl', DEFAULT_URL)).replace(/\/+$/, ''); }
    function helperToken() { return String(GM_getValue('token', '')); }

    function toast(text) {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1e1f24;color:#e6e6e6;border:1px solid #444;border-radius:6px;padding:10px 16px;font:14px sans-serif;box-shadow:0 4px 16px #0008';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 5000);
    }

    // The one request to the helper; guardRequest makes a lost callback count as failed after REQUEST_WATCHDOG_MS.
    function request(method, path, body) {
        return guardRequest((done) => GM_xmlhttpRequest({
            method,
            url: helperUrl() + path,
            headers: { 'X-MWI-Token': helperToken(), 'Content-Type': 'application/json' },
            data: body === undefined ? undefined : JSON.stringify(body),
            timeout: 10000,
            onload: (r) => done({ ok: r.status >= 200 && r.status < 300, status: r.status, text: r.responseText }),
            onerror: () => done({ ok: false, status: 0 }),
            ontimeout: () => done({ ok: false, status: 0 }),
        }), REQUEST_WATCHDOG_MS, (fn, ms) => setTimeout(fn, ms));
    }

    const recorder = createRecorder({
        post: async (lines) => {
            const r = await request('POST', '/v1/lines', lines);
            // A 0.2.0 helper lists the channels it takes; an older one does not (it files every line as guild).
            if (r.ok) { try { const b = JSON.parse(r.text); r.chans = b && Array.isArray(b.chans) ? b.chans : null; } catch { r.chans = null; } }
            if (!r.ok && !toastShown && document.body) {
                toastShown = true;
                toast('MWICS Chat Export: helper not reachable or token wrong (status ' + r.status + '). Lines are kept and retried.');
            }
            return r;
        },
        getCursor: async () => {
            const r = await request('GET', '/v1/cursor');
            if (!r.ok) return null;
            try { const c = JSON.parse(r.text); return c && typeof c === 'object' ? c : {}; } catch { return null; } // the recorder reads it (readCursors)
        },
        now: () => Date.now(),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        log: (text) => console.debug('[MWICS Guild Chat] ' + text),
    });

    // Read-only hook, chained onto whatever getter is already there. It reads the message the page already received; it never sends.
    function hook() {
        const proto = page.MessageEvent.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'data');
        const previousGet = desc.get;
        desc.get = function mwicsGuildChatGet() {
            const message = previousGet.call(this);
            try {
                const socket = this.currentTarget;
                if (!seenEvents.has(this) && typeof message === 'string' && socket && GAME_SOCKET_HOSTS.some((h) => String(socket.url || '').includes(h))) {
                    seenEvents.add(this);
                    const obj = parseFrame(message);
                    if (obj) recorder.push(obj, String(socket.url || '').includes('api-test.') ? 'test' : 'live');
                }
            } catch (e) {
                console.error('[MWICS Guild Chat] read failed', e);
            }
            return message;
        };
        Object.defineProperty(proto, 'data', desc);
    }

    hook();
    page.addEventListener('pagehide', () => { recorder.endSession(); });
    GM_registerMenuCommand('Set helper token', () => {
        const v = page.prompt('Paste the token the helper printed:', helperToken());
        if (v !== null) { GM_setValue('token', v.trim()); toastShown = false; recorder.flush(); }
    });
    GM_registerMenuCommand('Set helper address', () => {
        const v = page.prompt('Helper address:', helperUrl());
        if (v !== null && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(v.trim())) GM_setValue('helperUrl', v.trim());
    });
    GM_registerMenuCommand('Status', () => {
        const s = recorder.state;
        toast('MWICS Chat Export: live ' + s.stats.received + ', sent ' + s.stats.sent + ', queued ' + s.queue.length + ', dropped ' + s.stats.dropped + ', failed sends ' + s.stats.failed + ', refused by the helper ' + s.stats.refused);
    });
})();
