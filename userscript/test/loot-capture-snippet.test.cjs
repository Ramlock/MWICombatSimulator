// Node test for the console snippet in docs/codebase/loot-capture-snippet.md, against a mocked MessageEvent, socket, document and Blob.
// Run: node userscript/test/loot-capture-snippet.test.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const md = fs.readFileSync(path.join(ROOT, 'docs', 'codebase', 'loot-capture-snippet.md'), 'utf8');
const code = /```js\r?\n([\s\S]*?)```/.exec(md)[1];

function makeEnv() {
    const forbidden = [];
    const downloads = [];
    const logs = [];
    class MessageEvent { constructor(data, target) { this._data = data; this.currentTarget = target; } get data() { return this._data; } }
    const env = {
        MessageEvent,
        console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) },
        Blob,
        Date,
        JSON,
        WeakSet,
        Set,
        Object,
        String,
        setTimeout: () => 0,
        URL: { createObjectURL: (blob) => { downloads.push(blob); return 'blob:mock'; }, revokeObjectURL: () => {} },
        document: {
            body: { appendChild: () => {} },
            createElement: () => ({ click() { downloads.push('click'); }, remove() {} }),
        },
        fetch: () => { forbidden.push('fetch'); throw new Error('fetch'); },
        XMLHttpRequest: function () { forbidden.push('xhr'); throw new Error('xhr'); },
    };
    env.window = env;
    return { env, forbidden, downloads, logs, MessageEvent };
}

const game = { url: 'wss://api.milkywayidle.com/ws' };
const other = { url: 'wss://example.org/socket' };
const msg = (o) => JSON.stringify(o);
const battle = { type: 'new_battle', battleId: 3, players: [{ character: { id: 1, name: 'A' }, totalLootMap: { x: { itemHrid: '/items/coin', count: 5 } } }], monsters: [{ hrid: '/monsters/fly' }] };
const upd = { type: 'battle_updated', mMap: { 0: { cHP: 0 } }, pMap: { 0: { cHP: 10 } } };
const completed = { type: 'action_completed', endCharacterAction: { actionHrid: '/actions/combat/fly', difficultyTier: 2 }, endCharacterItems: [{ itemHrid: '/items/secret' }] };

(async () => {
    const t = makeEnv();
    // A previous hook (like Toolasha's) that the snippet must chain onto.
    const proto = t.MessageEvent.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'data');
    let previousCalls = 0;
    Object.defineProperty(proto, 'data', { configurable: true, get() { previousCalls++; return original.get.call(this); } });

    vm.runInNewContext(code, t.env);
    assert.ok(t.env.mwicsCapture, 'installed');

    const feed = (obj, target = game, reads = 1) => {
        const text = typeof obj === 'string' ? obj : msg(obj);
        const e = new t.MessageEvent(text, target);
        let out;
        for (let i = 0; i < reads; i++) out = e.data;
        assert.equal(out, text, 'message passed on unchanged');
    };
    feed(battle, game, 3); // read three times: recorded once
    feed(upd);
    feed({ type: 'loot_log_updated', lootLog: [{ characterActionId: 1, drops: { '/items/coin': 3 } }] });
    feed({ type: 'actions_updated', endCharacterActions: [] });
    feed({ type: 'market_listings_updated', x: 1 }); // not wanted
    feed(battle, other); // other socket
    feed(completed);
    feed('not json at all');
    assert.ok(previousCalls >= 8, 'previous getter chained');

    // second paste does nothing
    const before = t.env.mwicsCapture;
    vm.runInNewContext(code, t.env);
    assert.equal(t.env.mwicsCapture, before);
    assert.deepEqual(JSON.parse(JSON.stringify(before.status().counts)), { new_battle: 1, battle_updated: 1, loot_log_updated: 1, actions_updated: 1, action_completed: 1 });

    before.save();
    const blob = t.downloads.find((d) => d !== 'click');
    const file = JSON.parse(await blob.text());
    assert.equal(file.format, 'mwics-loot-capture');
    assert.equal(file.version, 1);
    assert.deepEqual(file.typeCensus, { new_battle: 1, battle_updated: 1, loot_log_updated: 1, actions_updated: 1, market_listings_updated: 1, action_completed: 1 }, 'census counts every type once per message, game socket only');
    assert.equal(file.messages.length, 5);
    assert.deepEqual(file.messages[0].payload, battle);
    assert.deepEqual(file.messages[1].payload, upd);
    assert.deepEqual(file.messages[4].payload, { type: 'action_completed', endCharacterAction: completed.endCharacterAction });
    assert.ok(!JSON.stringify(file).includes('secret'), 'rest of action_completed not kept');
    assert.ok(file.messages.every((m) => typeof m.t === 'number'));
    assert.deepEqual(t.forbidden, [], 'no network calls');

    // stop and clear
    before.stop();
    feed(battle);
    assert.equal(before.status().messages, 5);
    before.clear();
    assert.equal(before.status().messages, 0);

    // size limit stops recording
    const t2 = makeEnv();
    vm.runInNewContext(code.replace('40 * 1024 * 1024', '2000'), t2.env);
    const e2 = (o) => { const e = new t2.MessageEvent(msg(o), game); return e.data; };
    for (let i = 0; i < 20; i++) e2(battle);
    const s2 = t2.env.mwicsCapture.status();
    assert.equal(s2.recording, false);
    assert.ok(s2.messages > 0 && s2.messages < 20);

    console.log('loot-capture-snippet: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
