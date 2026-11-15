// Node test for userscript/mwics-guildchat.user.js on made-up chat fixtures (no real chat line, name or id).
// Run: node userscript/test/guildchat.test.cjs
// Checks: only the guild channel is ever recorded; cursor dedupe and gap lines on connect; refresh and live dedupe; deletion becomes an
// update line; queue, retry and overflow gap; batch caps; strict arrival order; a slow send never holds back the next lines (they are
// stamped when read and batched); nothing is sent while a connect reads the cursor; and a grep that the source is read-only toward the game.
// Party (0.2.0): party lines kept and tagged, guild unchanged, other channels dropped, both histories on connect with per-channel cursors,
// per-channel dedupe and gaps, nothing of the party sent to a helper older than 0.2.0, and party lines held until the helper says it takes them.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SRC = path.join(__dirname, '..', 'mwics-guildchat.user.js');
const source = fs.readFileSync(SRC, 'utf8');
const mod = { exports: {} };
vm.runInNewContext(source, { module: mod, console });
const { createRecorder, planHistory, frameType, parseFrame, GUILD_CHAN, KEPT_CHANNELS, MAX_QUEUE, MAX_BATCH_LINES, guardRequest, REQUEST_WATCHDOG_MS } = mod.exports;
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
const PARTY = '/chat_channel_types/party';
const pmsg = (id, t, extra = {}) => ({ ...msg(id, t), chan: PARTY, ...extra });
const init2 = (guildChatHistory, partyChatHistory, id = 1) => ({ type: 'init_character_data', character: { id }, guildChatHistory, partyChatHistory });
const ofChan = (sent, chan) => sent.filter((l) => l.chan === chan);

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

    await test('never skip: cursor id missing from the history but its time inside it: the whole history is sent, no gap', async () => {
        const h = harness({ cursor: { id: 'gone', t: T(3) } });
        await h.rec.push(init([1, 2, 4, 5].map((i) => msg(i, T(i)))));
        assert.deepEqual(msgs(h.sent).map((l) => l.id), ['1', '2', '4', '5']);
        assert.ok(!types(h.sent).includes('gap'));
    });

    await test('never skip: the 2026-11-13 case replayed (made-up ids): a marker moved by another tab to a later time sends the whole history of both channels', async () => {
        // The marker points at a line of another tab, newer than everything this tab has: before 0.2.0 the time fall-back skipped lines 7-10.
        const h = harness2({ guild: { id: 'other-77', t: T(30) }, party: { id: 'other-78', t: T(31) } });
        await h.rec.push(init2([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => msg(i, T(i))), [1, 2, 3].map((i) => pmsg(i, T(i)))));
        assert.deepEqual(msgs(ofChan(h.sent, 'guild')).map((l) => l.id), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
        assert.deepEqual(msgs(ofChan(h.sent, 'party')).map((l) => l.id), ['1', '2', '3']);
        assert.ok(!types(h.sent).includes('gap'), 'the history reaches back past the marker: nothing can be missing');
    });

    await test('never skip: a marker older than the whole history still gets its gap line, and the whole history follows', async () => {
        const h = harness2({ guild: { id: 'gone', t: T(1) }, party: { id: 'gone-too', t: T(2) } });
        await h.rec.push(init2([10, 11].map((i) => msg(i, T(i))), [12].map((i) => pmsg(i, T(i)))));
        const gaps = h.sent.filter((l) => l.type === 'gap');
        assert.deepEqual(gaps.map((l) => l.chan + ':' + l.from + '>' + l.to), ['guild:' + T(1) + '>' + T(10), 'party:' + T(2) + '>' + T(12)]);
        assert.deepEqual(msgs(h.sent).map((l) => l.chan + ':' + l.id), ['guild:10', 'guild:11', 'party:12']);
    });

    await test('server and character: every line says the server of its socket and the character id (as a string)', async () => {
        const h = harness2();
        await h.rec.push(init2([msg(1, T(1))], [pmsg(2, T(2))], 4242), 'test');
        await h.rec.push(live(msg(3, T(3))), 'test');
        await h.rec.endSession();
        assert.ok(h.sent.length >= 6);
        assert.ok(h.sent.every((l) => l.server === 'test' && l.character === '4242'), JSON.stringify(h.sent.map((l) => [l.type, l.server, l.character])));
        const m = harness2();
        await m.rec.push(init2([msg(1, T(1))], [], 4243));
        assert.ok(m.sent.every((l) => l.server === 'live' && l.character === '4243'), 'no server given is the main server');
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
        assert.equal(h.rec.state.stats.dropped, 7); // the two session lines (guild, party) and the five oldest guild lines
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

    await test('a request whose callback never comes counts as failed after the watchdog, and the retry then delivers the lines', async () => {
        assert.equal(REQUEST_WATCHDOG_MS, 30000);
        const timers = [];
        const sent = [];
        let lose = true;
        const setTimer = (fn, ms) => timers.push({ fn, ms });
        const rec = createRecorder({
            post: (lines) => guardRequest((done) => { if (!lose) { sent.push(...plain(lines)); done({ ok: true, status: 200 }); } }, REQUEST_WATCHDOG_MS, setTimer),
            getCursor: async () => null,
            now: () => Date.UTC(2030, 0, 1),
            setTimer,
            log: () => {},
        });
        rec.push(init([]));
        rec.push(live(msg(1, T(1))));
        await settle();
        assert.equal(rec.state.flushing, true, 'the send is in flight and its callback never comes');
        const dog = timers.find((t) => t.ms === REQUEST_WATCHDOG_MS);
        lose = false;
        dog.fn();
        await settle();
        assert.equal(rec.state.flushing, false, 'the watchdog ends the send as failed');
        const retry = timers.find((t) => t.ms === 2000);
        assert.ok(retry, 'the normal retry is scheduled');
        retry.fn();
        await settle();
        assert.deepEqual(msgs(sent).map((l) => l.id), ['1']);
        let late;
        const r = await guardRequest((done) => { late = done; }, 5, (fn) => fn());
        late({ ok: true, status: 200 });
        assert.equal(r.ok, false);
        assert.equal(r.timedOut, true, 'a late callback is ignored');
    });

    // ---- Party channel (0.2.0) ----
    // A 0.2.0 helper: its cursor reply carries chans (per channel), its post reply lists the channels it takes.
    function harness2({ guild = null, party = null, helper = 'new', cursorFails = false } = {}) {
        const sent = [];
        const logs = [];
        let failures = 0;
        const deps = {
            post: async (lines) => {
                if (failures > 0) { failures--; return { ok: false, status: 0 }; }
                sent.push(...plain(lines));
                return helper === 'new' ? { ok: true, status: 200, chans: ['guild', 'party'] } : { ok: true, status: 200, chans: null };
            },
            getCursor: async () => {
                if (cursorFails) return null;
                if (helper === 'new') return { ...(guild || {}), chans: { guild: guild || {}, party: party || {} } };
                return guild || {};
            },
            now: () => Date.UTC(2030, 0, 1, 13, 0, 0),
            setTimer: () => {},
            log: (t) => logs.push(t),
        };
        return { rec: createRecorder(deps), sent, logs, setFailures: (k) => { failures = k; } };
    }

    await test('party: the kept channels are data, guild and party, nothing else', () => {
        assert.deepEqual(plain(KEPT_CHANNELS).map((k) => k.hrid), [GUILD, PARTY]);
        assert.deepEqual(plain(KEPT_CHANNELS).map((k) => k.chan), ['guild', 'party']);
        assert.equal(KEPT_CHANNELS.find((k) => k.chan === 'party').history, 'partyChatHistory');
    });

    await test('party: live party lines are kept and tagged party, guild lines tagged guild, every other channel dropped in the page', async () => {
        const h = harness2();
        await h.rec.push(init2([], []));
        for (const chan of ['/chat_channel_types/general', '/chat_channel_types/whisper', '/chat_channel_types/trade', '/chat_channel_types/moderator', '/chat_channel_types/recruit', '/chat_channel_types/english']) {
            await h.rec.push(live({ ...msg(1, T(1)), chan }));
        }
        assert.equal(msgs(h.sent).length, 0);
        await h.rec.push(live(pmsg(2, T(2))));
        await h.rec.push(live(msg(3, T(3))));
        assert.deepEqual(msgs(h.sent).map((l) => l.chan + ':' + l.id), ['party:2', 'guild:3']);
        assert.ok(h.sent.every((l) => l.chan === 'guild' || l.chan === 'party'), 'every line carries its channel');
        assert.deepEqual(h.sent.filter((l) => l.type === 'session').map((l) => l.chan), ['guild', 'party']);
        const whisperRaw = JSON.stringify(h.sent);
        assert.ok(!whisperRaw.includes('whisper') && !whisperRaw.includes('general'));
    });

    await test('party: a guild line keeps exactly its 0.1.1 shape plus chan', async () => {
        const h = harness2();
        await h.rec.push(init2([], [], 901));
        await h.rec.push(live(msg(4, T(4), { cId: 901 })));
        const [a] = msgs(h.sent);
        assert.deepEqual(Object.keys(a), ['v', 'type', 'chan', 'id', 't', 'sName', 'cId', 'm', 'o', 'system', 'mod', 'own', 'links', 'seen', 'src', 'server', 'character']);
        assert.equal(a.chan, 'guild');
        assert.equal(a.own, true);
    });

    await test('party: a party system line is stored as received (the key in m, the parameters in meta)', async () => {
        const h = harness2();
        await h.rec.push(init2([], []));
        await h.rec.push(live(pmsg(5, T(5), { isSystemMessage: true, sName: null, cId: null, m: 'systemChatMessage.partyMemberReady', systemMetadata: '{"name":"Example"}' })));
        await h.rec.push(live(pmsg(6, T(6), { isSystemMessage: true, m: 'systemChatMessage.partyBattleStarted', systemMetadata: '{"actionHrid":"/actions/combat/example"}' })));
        const [a, b] = msgs(h.sent);
        assert.equal(a.chan, 'party');
        assert.equal(a.system, true);
        assert.equal(a.m, 'systemChatMessage.partyMemberReady');
        assert.equal(a.meta.system, '{"name":"Example"}');
        assert.equal(b.m, 'systemChatMessage.partyBattleStarted');
    });

    await test('party: on connect both histories are sent, each against its own channel cursor, each gap tagged with its channel', async () => {
        const h = harness2({ guild: { id: '2', t: T(2) }, party: { id: '1', t: T(1) } });
        await h.rec.push(init2([1, 2, 3].map((i) => msg(i, T(i))), [10, 11].map((i) => pmsg(i, T(i)))));
        assert.deepEqual(msgs(ofChan(h.sent, 'guild')).map((l) => l.id + ':' + l.src), ['3:history']);
        assert.deepEqual(msgs(ofChan(h.sent, 'party')).map((l) => l.id + ':' + l.src), ['10:history', '11:history']);
        const gaps = h.sent.filter((l) => l.type === 'gap');
        assert.deepEqual(gaps.map((l) => l.chan + ':' + l.from + '>' + l.to), ['party:' + T(1) + '>' + T(10)]);
        const h2 = harness2();
        await h2.rec.push(init2([msg(1, T(1))], [pmsg(1, T(1)), { ...pmsg(2, T(2)), chan: '/chat_channel_types/whisper' }]));
        assert.deepEqual(msgs(h2.sent).map((l) => l.chan + ':' + l.id), ['guild:1', 'party:1'], 'the same id in two channels is two lines; a whisper in the party history is dropped');
        assert.deepEqual(h2.sent.filter((l) => l.type === 'gap').map((l) => l.chan + ':' + l.from), ['guild:null', 'party:null']);
    });

    await test('party: repeats are dropped per channel, deletions become one update tagged party', async () => {
        const h = harness2();
        const ph = [1, 2].map((i) => pmsg(i, T(i)));
        await h.rec.push(init2([], ph));
        await h.rec.push(live(pmsg(2, T(2))));
        await h.rec.push(init2([], ph));
        await h.rec.push(live(msg(2, T(2)))); // same id, guild channel: its own line
        assert.deepEqual(msgs(h.sent).map((l) => l.chan + ':' + l.id), ['party:1', 'party:2', 'guild:2']);
        await h.rec.push({ type: 'chat_message_updated', message: { ...pmsg(1, T(1)), isDeleted: true, deleteReason: '/delete_reasons/spam' } });
        await h.rec.push({ type: 'chat_message_updated', message: { ...pmsg(1, T(1)), isDeleted: true, deleteReason: '/delete_reasons/spam' } });
        const ups = h.sent.filter((l) => l.type === 'update');
        assert.deepEqual(ups.map((l) => l.chan + ':' + l.id), ['party:1']);
    });

    await test('party: the guild refresh touches only the guild channel', async () => {
        const h = harness2();
        await h.rec.push(init2([], []));
        await h.rec.push({ type: 'guild_chat_history_updated', guildChatHistory: [msg(1, T(1)), pmsg(2, T(2))] });
        assert.deepEqual(msgs(h.sent).map((l) => l.chan + ':' + l.id), ['guild:1']);
    });

    await test('party: against a helper older than 0.2.0 no party line is ever sent (it would land in the guild file); guild unchanged', async () => {
        const h = harness2({ helper: 'old', guild: { id: '1', t: T(1) } });
        await h.rec.push(init2([1, 2].map((i) => msg(i, T(i))), [pmsg(5, T(5))]));
        await h.rec.push(live(pmsg(6, T(6))));
        await h.rec.push(live(msg(3, T(3))));
        await h.rec.endSession();
        assert.ok(h.sent.every((l) => l.chan === 'guild'));
        assert.deepEqual(msgs(h.sent).map((l) => l.id), ['2', '3']);
        assert.ok(h.rec.state.stats.refused >= 2, 'the party session line and history are refused');
    });

    await test('party: while the helper has not yet said what it takes, party lines wait; its first reply that lists party sends them', async () => {
        const h = harness2({ cursorFails: true });
        h.setFailures(1000);
        await h.rec.push(init2([], [pmsg(1, T(1))]));
        await h.rec.push(live(pmsg(2, T(2))));
        assert.equal(h.sent.length, 0);
        assert.ok(h.rec.state.queue.some((l) => l.chan === 'party'), 'party lines are held, not dropped');
        h.setFailures(0);
        await h.rec.flush();
        await h.rec.flush();
        assert.deepEqual(msgs(h.sent).map((l) => l.chan + ':' + l.id), ['party:1', 'party:2']);
        assert.equal(h.sent[0].chan, 'guild', 'the guild session line goes first and its reply opens the party channel');
        assert.equal(h.rec.state.queue.length, 0);
    });

    await test('party: past the queue cap each channel that lost lines gets its own gap line', async () => {
        const h = harness2();
        await h.rec.push(init2([], []));
        h.setFailures(1000000);
        for (let i = 1; i <= MAX_QUEUE / 2 + 3; i++) { await h.rec.push(live(msg(i, T(1)))); await h.rec.push(live(pmsg(i, T(2)))); }
        h.setFailures(0);
        await h.rec.flush();
        while (h.rec.state.queue.length) await h.rec.flush();
        const gaps = h.sent.filter((l) => l.type === 'gap');
        assert.deepEqual(gaps.map((l) => l.chan).sort(), ['guild', 'party']);
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
