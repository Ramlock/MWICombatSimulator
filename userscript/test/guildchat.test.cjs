// Node test for userscript/mwics-guildchat.user.js on made-up chat fixtures (no real chat line, name or id).
// Run: node userscript/test/guildchat.test.cjs
// Checks: only the guild channel is ever recorded; cursor dedupe and gap lines on connect; refresh and live dedupe; deletion becomes an
// update line; queue, retry and overflow gap; batch caps; strict arrival order; a slow send never holds back the next lines (they are
// stamped when read and batched); nothing is sent while a connect reads the cursor; and a grep that the source is read-only toward the game.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = path.join(__dirname, '..', 'mwics-guildchat.user.js');
const source = fs.readFileSync(SRC, 'utf8');
const mod = { exports: {} };
vm.runInNewContext(source, { module: mod, console });
const { createRecorder, planHistory, frameType, parseFrame, GUILD_CHAN, MAX_QUEUE, MAX_BATCH_LINES } = mod.exports;
const plain = (x) => JSON.parse(JSON.stringify(x)); // the script runs in its own realm

const GUILD = GUILD_CHAN;
const msg = (id, t, extra = {}) => ({ id, t, chan: GUILD, cId: 900 + (id % 3), sName: 'Cow' + (id % 3), m: 'hello ' + id, ...extra });
const T = (min) => new Date(Date.UTC(2030, 0, 1, 12, min, 0)).toISOString();

function harness({ cursor = null, failFirst = 0 } = {}) {
    const sent = [];
    const timers = [];
    const logs = [];
    let failures = failFirst;
    const clock = Date.UTC(2030, 0, 1, 13, 0, 0);
    const deps = {
        post: async (lines) => {
            if (failures > 0) { failures--; return { ok: false, status: 0 }; }
            sent.push(...plain(lines));
            return { ok: true, status: 200 };
        },
        getCursor: async () => cursor,
        now: () => clock,
        setTimer: (fn, ms) => timers.push({ fn, ms }),
        log: (t) => logs.push(t),
    };
    const rec = createRecorder(deps);
    return { rec, sent, timers, logs, setFailures: (k) => { failures = k; } };
}
const init = (history, id = 1) => ({ type: 'init_character_data', character: { id }, guildChatHistory: history });
const live = (m) => ({ type: 'chat_message_received', message: m });
const msgs = (sent) => sent.filter((l) => l.type === 'msg');
const types = (sent) => sent.map((l) => l.type);
const settle = () => new Promise((r) => setImmediate(r));

let n = 0;
async function test(name, fn) { await fn(); n++; console.log('ok - ' + name); }

(async () => {
    await test('only the guild channel is recorded, every other channel is dropped', async () => {
        const h = harness();
        await h.rec.push(init([]));
        for (const chan of ['/chat_channel_types/general', '/chat_channel_types/whisper', '/chat_channel_types/party', '/chat_channel_types/trade', '/chat_channel_types/moderator']) {
            await h.rec.push(live({ ...msg(1, T(1)), chan }));
        }
        assert.equal(msgs(h.sent).length, 0);
        await h.rec.push(live(msg(2, T(2))));
        assert.equal(msgs(h.sent).length, 1);
        assert.equal(msgs(h.sent)[0].id, '2');
        const h2 = harness();
        await h2.rec.push(init([msg(1, T(1)), { ...msg(2, T(2)), chan: '/chat_channel_types/whisper' }]));
        assert.deepEqual(msgs(h2.sent).map((l) => l.id), ['1']);
    });

    await test('a live line has the versioned shape and the own / system / mod flags', async () => {
        const h = harness();
        await h.rec.push(init([], 901));
        await h.rec.push(live(msg(4, T(4), { cId: 901 })));
        await h.rec.push(live(msg(5, T(5), { isSystemMessage: true, m: 'systemChatMessage.characterLeveledUp', systemMetadata: '{"x":1}' })));
        await h.rec.push(live(msg(6, T(6), { isModMessage: true, o: 'orig', linksMetadata: '[]' })));
        const [a, b, c] = msgs(h.sent);
        assert.equal(a.v, 1);
        assert.equal(a.src, 'live');
        assert.equal(a.own, true);
        assert.equal(a.system, false);
        assert.equal(a.o, null);
        assert.equal(a.t, T(4));
        assert.equal(b.system, true);
        assert.equal(b.meta.system, '{"x":1}');
        assert.equal(c.mod, true);
        assert.equal(c.o, 'orig');
        assert.equal(c.own, false);
    });

    await test('a session line is written on connect and on end', async () => {
        const h = harness();
        await h.rec.push(init([]));
        assert.deepEqual(types(h.sent), ['session']);
        assert.equal(h.sent[0].event, 'start');
        await h.rec.endSession();
        assert.deepEqual(h.sent.map((l) => l.event).filter(Boolean), ['start', 'end']);
    });

    await test('connect with a cursor inside the history sends only what follows it, no gap', async () => {
        const h = harness({ cursor: { id: '3', t: T(3) } });
        await h.rec.push(init([1, 2, 3, 4, 5].map((i) => msg(i, T(i)))));
        assert.deepEqual(msgs(h.sent).map((l) => l.id), ['4', '5']);
        assert.ok(!types(h.sent).includes('gap'));
        assert.ok(msgs(h.sent).every((l) => l.src === 'history'));
    });

    await test('connect with a cursor older than the whole history writes one gap line first', async () => {
        const h = harness({ cursor: { id: '1', t: T(1) } });
        await h.rec.push(init([10, 11].map((i) => msg(i, T(i)))));
        const gap = h.sent.find((l) => l.type === 'gap');
        assert.equal(gap.from, T(1));
        assert.equal(gap.to, T(10));
        assert.deepEqual(msgs(h.sent).map((l) => l.id), ['10', '11']);
        assert.ok(h.sent.indexOf(gap) < h.sent.indexOf(msgs(h.sent)[0]));
    });

    await test('cursor id missing from the history but its time inside it: falls back to time, no gap', async () => {
        const h = harness({ cursor: { id: 'gone', t: T(3) } });
        await h.rec.push(init([1, 2, 4, 5].map((i) => msg(i, T(i)))));
        assert.deepEqual(msgs(h.sent).map((l) => l.id), ['4', '5']);
        assert.ok(!types(h.sent).includes('gap'));
    });

    await test('the first run (no cursor) writes the history and marks a gap from nothing', async () => {
        const h = harness();
        await h.rec.push(init([1, 2].map((i) => msg(i, T(i)))));
        const gap = h.sent.find((l) => l.type === 'gap');
        assert.equal(gap.from, null);
        assert.equal(gap.to, T(1));
        assert.equal(msgs(h.sent).length, 2);
    });

    await test('a cursor with an empty history decides nothing (no gap, no lines)', async () => {
        const h = harness({ cursor: { id: '3', t: T(3) } });
        await h.rec.push(init([]));
        assert.deepEqual(types(h.sent), ['session']);
    });

    await test('a repeated history, a refresh and a repeated live id are never sent twice', async () => {
        const h = harness();
        const hist = [1, 2, 3].map((i) => msg(i, T(i)));
        await h.rec.push(init(hist));
        await h.rec.push({ type: 'guild_chat_history_updated', guildChatHistory: [...hist, msg(4, T(4))] });
        await h.rec.push(live(msg(4, T(4))));
        await h.rec.push(live(msg(3, T(3))));
        await h.rec.push(init(hist));
        assert.deepEqual(msgs(h.sent).map((l) => l.id), ['1', '2', '3', '4']);
    });

    await test('a deletion (updated message or refreshed history) becomes one update line, once', async () => {
        const h = harness();
        await h.rec.push(init([msg(1, T(1)), msg(2, T(2))]));
        await h.rec.push({ type: 'chat_message_updated', message: { ...msg(1, T(1)), isDeleted: true, deleteReason: '/delete_reasons/spam' } });
        await h.rec.push({ type: 'chat_message_updated', message: { ...msg(1, T(1)), isDeleted: true, deleteReason: '/delete_reasons/spam' } });
        await h.rec.push({ type: 'guild_chat_history_updated', guildChatHistory: [{ ...msg(1, T(1)), isDeleted: true }, { ...msg(2, T(2)), isDeleted: true }] });
        const ups = h.sent.filter((l) => l.type === 'update');
        assert.deepEqual(ups.map((l) => l.id), ['1', '2']);
        assert.equal(ups[0].isDeleted, true);
        assert.equal(ups[0].deleteReason, '/delete_reasons/spam');
        await h.rec.push({ type: 'chat_message_updated', message: { ...msg(9, T(9)), chan: '/chat_channel_types/general', isDeleted: true } });
        assert.equal(h.sent.filter((l) => l.type === 'update').length, 2);
    });

    await test('an unreachable helper keeps the lines, retries with backoff, and delivers each once in order', async () => {
        const h = harness({ failFirst: 4 });
        await h.rec.push(init([]));
        await h.rec.push(live(msg(1, T(1))));
        await h.rec.push(live(msg(2, T(2))));
        assert.equal(h.sent.length, 0);
        assert.equal(h.timers.length, 1);
        assert.equal(h.timers[0].ms, 2000);
        assert.ok(h.rec.state.queue.length >= 3);
        h.timers.shift().fn();
        await settle();
        assert.equal(h.sent.length, 0);
        assert.equal(h.timers.length, 1);
        assert.equal(h.timers[0].ms, 4000);
        h.timers.shift().fn();
        await settle();
        assert.deepEqual(msgs(h.sent).map((l) => l.id), ['1', '2']);
        assert.equal(h.rec.state.queue.length, 0);
    });

    await test('past the queue cap the oldest lines are dropped and one gap line says so', async () => {
        const h = harness({ failFirst: 1000000 });
        await h.rec.push(init([]));
        for (let i = 1; i <= MAX_QUEUE + 5; i++) await h.rec.push(live(msg(i, T(1))));
        assert.equal(h.rec.state.queue.length, MAX_QUEUE);
        assert.equal(h.rec.state.stats.dropped, 6);
        h.setFailures(0);
        h.timers.shift().fn();
        await settle();
        await h.rec.flush();
        const gaps = h.sent.filter((l) => l.type === 'gap');
        assert.equal(gaps.length, 1);
        assert.ok(gaps[0].from && gaps[0].to);
        assert.equal(msgs(h.sent).length, MAX_QUEUE);
        assert.ok(h.sent.indexOf(gaps[0]) < h.sent.indexOf(msgs(h.sent)[0]));
    });

    await test('a batch never holds more than the line cap', async () => {
        const batches = [];
        const rec = createRecorder({
            post: async (lines) => { batches.push(plain(lines).length); return { ok: true, status: 200 }; },
            getCursor: async () => null,
            now: () => Date.UTC(2030, 0, 1),
            setTimer: () => {},
            log: () => {},
        });
        await rec.push(init(Array.from({ length: 600 }, (_, i) => msg(i + 1, T(1)))));
        assert.ok(batches.length >= 3);
        assert.ok(batches.every((b) => b <= MAX_BATCH_LINES));
        assert.equal(batches.reduce((a, b) => a + b, 0), 602);
    });

    await test('a live line right after the connect waits for the history sync (strict arrival order)', async () => {
        const h = harness({ cursor: { id: '1', t: T(1) } });
        h.rec.push(init([1, 2].map((i) => msg(i, T(i)))));
        h.rec.push(live(msg(3, T(3))));
        await h.rec.push(live(msg(4, T(4))));
        assert.deepEqual(msgs(h.sent).map((l) => l.id), ['2', '3', '4']);
    });

    await test('a slow send never holds back the next lines: they are stamped when read and all go in the next batch', async () => {
        const posts = [];
        let clock = Date.UTC(2030, 0, 1, 13, 0, 0);
        const rec = createRecorder({
            post: (lines) => new Promise((resolve) => posts.push({ lines: plain(lines), resolve })),
            getCursor: async () => null,
            now: () => clock,
            setTimer: () => {},
            log: () => {},
        });
        rec.push(init([]));
        await settle();
        assert.equal(posts.length, 1); // the session line, in flight and not answered (a throttled tab)
        for (let i = 1; i <= 5; i++) { clock += 60000; rec.push(live(msg(i, T(i)))); }
        await settle();
        assert.equal(posts.length, 1, 'no second send while one is in flight');
        const queued = plain(rec.state.queue).filter((l) => l.type === 'msg');
        assert.deepEqual(queued.map((l) => l.id), ['1', '2', '3', '4', '5'], 'every line is queued when read');
        assert.deepEqual(queued.map((l) => l.seen), [1, 2, 3, 4, 5].map((k) => new Date(Date.UTC(2030, 0, 1, 13, k, 0)).toISOString()), 'stamped when read');
        posts[0].resolve({ ok: true, status: 200 });
        await settle();
        assert.equal(posts.length, 2);
        assert.deepEqual(posts[1].lines.map((l) => l.id), ['1', '2', '3', '4', '5'], 'one batch, not one send per line');
        posts[1].resolve({ ok: true, status: 200 });
        await settle();
        assert.equal(rec.state.queue.length, 0);
    });

    await test('while a connect reads the cursor nothing is sent, live lines are still queued, and the history goes in ahead of them', async () => {
        const sent = [];
        let answer;
        const rec = createRecorder({
            post: async (lines) => { sent.push(...plain(lines)); return { ok: true, status: 200 }; },
            getCursor: () => new Promise((resolve) => { answer = resolve; }),
            now: () => Date.UTC(2030, 0, 1, 13, 0, 0),
            setTimer: () => {},
            log: () => {},
        });
        rec.push(init([1, 2, 3].map((i) => msg(i, T(i)))));
        rec.push(live(msg(4, T(4))));
        rec.push(live(msg(3, T(3)))); // also in the history: queued once, as live
        await settle();
        assert.equal(sent.length, 0, 'held until the cursor is read');
        assert.deepEqual(plain(rec.state.queue).filter((l) => l.type === 'msg').map((l) => l.id), ['4', '3']);
        answer({ id: '1', t: T(1) });
        await rec.idle();
        assert.deepEqual(msgs(sent).map((l) => l.id + ':' + l.src), ['2:history', '4:live', '3:live']);
        assert.equal(sent[0].type, 'session');
    });

    await test('planHistory is pure: same input, same plan, input untouched', () => {
        const hist = [1, 2, 3].map((i) => msg(i, T(i)));
        const copy = JSON.stringify(hist);
        const known = new Map();
        const a = plain(planHistory(hist, { id: '1', t: T(1) }, known, 'connect'));
        const b = plain(planHistory(hist, { id: '1', t: T(1) }, known, 'connect'));
        assert.deepEqual(a, b);
        assert.equal(JSON.stringify(hist), copy);
        assert.equal(known.size, 0);
    });

    await test('frame prefilter parses only the watched types', () => {
        assert.equal(frameType('{"type":"chat_message_received","message":{}}'), 'chat_message_received');
        assert.equal(frameType('not json'), null);
        assert.equal(parseFrame('{"type":"market_updated","x":1}'), null);
        assert.equal(plain(parseFrame('{"type":"chat_message_updated","message":{"id":1}}')).message.id, 1);
        assert.equal(parseFrame('{"type":"chat_message_received", broken'), null);
    });

    await test('read-only toward the game: no socket send, no chat request, no cookies or page storage, only the local helper as network', () => {
        const code = source.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
        const banned = [
            [/\.send\s*\(/, '.send('],
            [/send_chat_message/, 'send_chat_message'],
            [/delete_(own_)?chat_message/, 'delete chat request'],
            [/report_chat_message/, 'report chat request'],
            [/new\s+WebSocket/, 'new WebSocket'],
            [/WebSocket\.prototype/, 'WebSocket.prototype'],
            [/localStorage/, 'localStorage'],
            [/sessionStorage/, 'sessionStorage'],
            [/document\.cookie/, 'document.cookie'],
            [/indexedDB/, 'indexedDB'],
            [/\.dispatchEvent\s*\(/, 'dispatchEvent'],
            [/\.click\s*\(/, 'click()'],
        ];
        for (const [re, label] of banned) assert.ok(!re.test(code), 'source contains ' + label);
        const hosts = [...code.matchAll(/https?:\/\/[^\s'"`/]+/g)].map((m) => m[0]);
        const allowed = [/^http:\/\/127\.0\.0\.1(:\d+)?$/, /^https?:\/\/localhost$/];
        for (const u of hosts) assert.ok(allowed.some((re) => re.test(u)), 'unexpected host ' + u);
    });

    console.log(n + ' tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
