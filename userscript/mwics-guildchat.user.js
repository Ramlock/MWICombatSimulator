// ==UserScript==
// @name         MWICS Guild Chat Export
// @namespace    https://github.com/Ramlock/MWICombatSimulator
// @version      0.1.1
// @description  Read-only live export of your own guild chat to a small local helper (127.0.0.1) that appends it to a file. Sends nothing to the game server, types nothing in the chat, never touches the login. Design: docs/codebase/guild-chat.md.
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
// reads cookies or page storage, and sends only guild-channel lines (other channels, whispers included, are dropped in the page).

(function () {
    'use strict';

    const GUILD_CHAN = '/chat_channel_types/guild';
    const GAME_SOCKET_HOSTS = ['api.milkywayidle.com/ws', 'api-test.milkywayidle.com/ws'];
    const WATCHED_TYPES = new Set(['init_character_data', 'chat_message_received', 'chat_message_updated', 'guild_chat_history_updated']);
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
    function toMsgLine(message, ownId, src, seen) {
        const line = {
            v: FORMAT_VERSION,
            type: 'msg',
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

    function toUpdateLine(message, seen) {
        return { v: FORMAT_VERSION, type: 'update', id: String(message.id), isDeleted: !!message.isDeleted, deleteReason: message.deleteReason ?? null, seen };
    }

    // Pure: which lines of a history array still need sending, given the helper's cursor ({id, t} or null) and what this page has sent.
    // 'connect' also decides the gap line; a 'refresh' (guild_chat_history_updated) only skips what is already known.
    function planHistory(history, cursor, known, mode) {
        const list = Array.isArray(history) ? history.filter((m) => m && m.chan === GUILD_CHAN && m.id !== undefined && m.id !== null) : [];
        const out = { fresh: [], gap: null, updates: [] };
        let start = 0;
        if (mode === 'connect' && cursor) {
            const at = list.findIndex((m) => String(m.id) === String(cursor.id));
            if (at >= 0) start = at + 1;
            else {
                const ct = Date.parse(cursor.t);
                start = list.findIndex((m) => Date.parse(m.t) > ct);
                if (start < 0) start = list.length;
                if (list.length && Date.parse(list[0].t) > ct) out.gap = { from: cursor.t, to: list[0].t };
            }
        } else if (mode === 'connect' && list.length) {
            out.gap = { from: null, to: list[0].t };
        }
        for (let i = 0; i < list.length; i++) {
            const m = list[i];
            const id = String(m.id);
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
            known: new Map(), // id -> isDeleted, ids this page has queued or sent
            queue: [],
            dropped: null, // {from, to} of lines dropped because the helper was unreachable too long
            retryMs: RETRY_MIN_MS,
            flushing: false,
            running: Promise.resolve(), // the send in progress
            timerSet: false,
            sessionOpen: false,
            hold: 0, // connects still reading the cursor: nothing is sent while above 0
            holdAt: 0, // where the history of the pending connect goes in the queue
            syncTail: Promise.resolve(), // connects are planned one after the other
            stats: { received: 0, queued: 0, sent: 0, dropped: 0, failed: 0 },
        };
        const stamp = () => iso(deps.now());

        function remember(id, deleted) {
            state.known.set(id, deleted);
            if (state.known.size > MAX_KNOWN_IDS) state.known.delete(state.known.keys().next().value);
        }

        function trim() {
            while (state.queue.length > MAX_QUEUE) {
                const lost = state.queue.shift();
                if (state.hold && state.holdAt > 0) state.holdAt--;
                state.stats.dropped++;
                const at = lost.t || lost.seen;
                state.dropped = state.dropped ? { from: state.dropped.from, to: at } : { from: at, to: at };
            }
        }

        function enqueue(line) {
            state.queue.push(line);
            state.stats.queued++;
            trim();
        }

        function nextBatch() {
            const lines = [];
            let bytes = 2;
            if (state.dropped) {
                lines.push({ v: FORMAT_VERSION, type: 'gap', from: state.dropped.from, to: state.dropped.to, seen: stamp() });
                bytes += 160;
            }
            let taken = 0;
            for (const l of state.queue) {
                const size = JSON.stringify(l).length + 1;
                if (lines.length >= MAX_BATCH_LINES || (lines.length && bytes + size > MAX_BATCH_BYTES)) break;
                lines.push(l);
                bytes += size;
                taken++;
            }
            return { lines, taken, withGap: !!state.dropped };
        }

        // Starts a send of what is queued, unless one is running (that one takes the new lines in its next batch) or a connect holds sending.
        // Returns the running send, so a caller may wait for it; no message handler does.
        function flush() {
            if (state.hold) return Promise.resolve();
            if (state.flushing) return state.running;
            state.flushing = true;
            state.running = (async () => {
                try {
                    while (!state.hold && (state.queue.length || state.dropped)) {
                        const { lines, taken, withGap } = nextBatch();
                        let res;
                        try { res = await deps.post(lines); } catch { res = { ok: false, status: 0 }; }
                        if (!res || !res.ok) {
                            state.stats.failed++;
                            deps.log('send failed status=' + (res ? res.status : 'none') + ' queued=' + state.queue.length);
                            scheduleRetry();
                            return;
                        }
                        state.queue.splice(0, taken);
                        if (withGap) state.dropped = null;
                        state.stats.sent += lines.length;
                        state.retryMs = RETRY_MIN_MS;
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

        function startSession() {
            if (state.sessionOpen) return;
            state.sessionOpen = true;
            enqueue({ v: FORMAT_VERSION, type: 'session', event: 'start', seen: stamp() });
        }

        function endSession() {
            if (!state.sessionOpen) return Promise.resolve();
            state.sessionOpen = false;
            state.queue.push({ v: FORMAT_VERSION, type: 'session', event: 'end', seen: stamp() });
            return flush();
        }

        // The lines a history array adds (gap, msg, update), each id remembered as it is planned.
        function planLines(history, cursor, mode) {
            const plan = planHistory(history, cursor, state.known, mode);
            const seen = stamp();
            const lines = [];
            if (plan.gap) lines.push({ v: FORMAT_VERSION, type: 'gap', from: plan.gap.from, to: plan.gap.to, seen });
            for (const m of plan.fresh) {
                lines.push(toMsgLine(m, state.ownId, 'history', seen));
                remember(String(m.id), !!m.isDeleted);
            }
            for (const m of plan.updates) {
                lines.push(toUpdateLine(m, seen));
                remember(String(m.id), true);
            }
            deps.log('history mode=' + mode + ' lines=' + (Array.isArray(history) ? history.length : 0) + ' fresh=' + plan.fresh.length + ' updates=' + plan.updates.length + ' gap=' + (plan.gap ? 'yes' : 'no') + ' cursor=' + (cursor ? 'yes' : 'no'));
            return lines;
        }

        // A connect: sending holds until the cursor is read, the history's lines go in where the hold began, then sending resumes.
        function syncConnect(history) {
            if (state.hold++ === 0) state.holdAt = state.queue.length;
            state.syncTail = state.syncTail.then(async () => {
                let cursor = null;
                try { cursor = await deps.getCursor(); } catch { cursor = null; }
                try {
                    const lines = planLines(history, cursor, 'connect');
                    state.queue.splice(state.holdAt, 0, ...lines);
                    state.holdAt += lines.length;
                    state.stats.queued += lines.length;
                    trim();
                } catch (e) {
                    deps.log('history error ' + (e && e.message));
                }
            }).finally(() => { if (--state.hold === 0) flush(); });
            return state.syncTail;
        }

        // Synchronous: a message is stamped and queued when it is read; the send is started, never waited for.
        function handle(obj) {
            if (!obj || typeof obj !== 'object') return;
            switch (obj.type) {
                case 'init_character_data': {
                    state.ownId = obj.character && obj.character.id !== undefined ? obj.character.id : null;
                    startSession();
                    syncConnect(obj.guildChatHistory || []);
                    return;
                }
                case 'guild_chat_history_updated':
                    for (const l of planLines(obj.guildChatHistory || [], null, 'refresh')) enqueue(l);
                    break;
                case 'chat_message_received': {
                    const m = obj.message;
                    if (!m || m.chan !== GUILD_CHAN || m.id === undefined || m.id === null) return; // every other channel is dropped here
                    state.stats.received++;
                    const id = String(m.id);
                    if (state.known.has(id)) return;
                    enqueue(toMsgLine(m, state.ownId, 'live', stamp()));
                    remember(id, !!m.isDeleted);
                    break;
                }
                case 'chat_message_updated': {
                    const m = obj.message;
                    if (!m || m.chan !== GUILD_CHAN || m.id === undefined || m.id === null) return;
                    const id = String(m.id);
                    if (!(m.isDeleted && state.known.get(id) !== true)) return;
                    enqueue(toUpdateLine(m, stamp()));
                    remember(id, true);
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
        function push(obj) {
            try { handle(obj); } catch (e) { deps.log('handler error ' + (e && e.message)); }
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

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createRecorder, planHistory, toMsgLine, toUpdateLine, frameType, parseFrame, GUILD_CHAN, MAX_QUEUE, MAX_BATCH_LINES, GAME_SOCKET_HOSTS };
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

    function request(method, path, body) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method,
                url: helperUrl() + path,
                headers: { 'X-MWI-Token': helperToken(), 'Content-Type': 'application/json' },
                data: body === undefined ? undefined : JSON.stringify(body),
                timeout: 10000,
                onload: (r) => resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: r.responseText }),
                onerror: () => resolve({ ok: false, status: 0 }),
                ontimeout: () => resolve({ ok: false, status: 0 }),
            });
        });
    }

    const recorder = createRecorder({
        post: async (lines) => {
            const r = await request('POST', '/v1/lines', lines);
            if (!r.ok && !toastShown && document.body) {
                toastShown = true;
                toast('MWICS Guild Chat: helper not reachable or token wrong (status ' + r.status + '). Lines are kept and retried.');
            }
            return r;
        },
        getCursor: async () => {
            const r = await request('GET', '/v1/cursor');
            if (!r.ok) return null;
            try { const c = JSON.parse(r.text); return c && c.id !== undefined && c.id !== null ? { id: c.id, t: c.t } : null; } catch { return null; }
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
                    if (obj) recorder.push(obj);
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
        toast('MWICS Guild Chat: live ' + s.stats.received + ', sent ' + s.stats.sent + ', queued ' + s.queue.length + ', dropped ' + s.stats.dropped + ', failed sends ' + s.stats.failed);
    });
})();
