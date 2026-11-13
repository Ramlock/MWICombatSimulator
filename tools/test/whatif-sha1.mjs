// Test: the page's synchronous sha1 (src/whatif/sha1.mjs) returns the same hex as node:crypto on a few hundred inputs: empty, every length
// 0..300 (the padding boundaries at 55, 56, 63, 64, 65 ...), unicode (CJK, emoji, a lone surrogate), random texts up to 6000 characters, and long texts.
// Usage: node tools/test/whatif-sha1.mjs        Exit code 0 on pass, 1 on fail.
import { createHash } from 'node:crypto';
import { sha1 } from '../../src/whatif/sha1.mjs';

let failed = 0, count = 0;
const ref = (t) => createHash('sha1').update(t).digest('hex');
const check = (label, text) => {
    count++;
    const a = sha1(text), b = ref(text);
    if (a !== b) { failed++; console.log('FAIL ' + label + ' (' + text.length + ' chars): ' + a + ' vs ' + b); }
};

check('empty', '');
check('abc', 'abc');
check('fox', 'The quick brown fox jumps over the lazy dog');
for (let n = 0; n <= 300; n++) check('a x ' + n, 'a'.repeat(n));
for (const s of ['你好，世界', '😀🚀 emoji', 'café üñí', '\ud800 lone high', 'lone low \udc00 x', '\u0000\u0001\u007f\u0080߿ࠀ￿']) check('unicode ' + s.length, s);
// Random texts from a mixed alphabet, a fixed generator so a failure repeats.
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const alphabet = [...'abcdefghijklmnopqrstuvwxyz0123456789 /{}[]:,"_-', 'é', '中', '文', '😀', '\n'];
for (let i = 0; i < 200; i++) {
    let t = '';
    const len = Math.floor(rnd() * 6000);
    for (let j = 0; j < len; j++) t += alphabet[Math.floor(rnd() * alphabet.length)];
    check('random ' + i, t);
}
// A run key's own shape: JSON of nested objects (core.mjs keyOf hashes JSON.stringify of the setups and options).
for (let i = 0; i < 60; i++) check('json ' + i, JSON.stringify({ s: [{ name: 'p' + i, player: { equipment: Array.from({ length: i }, (_, k) => ({ itemHrid: '/items/x' + k, enhancementLevel: k % 12 })) } }], o: { tier: 4, zone: '/actions/combat/infernal_abyss' } }));
// Long texts.
check('1 MB of a', 'a'.repeat(1 << 20));
check('3 MB mixed', ('中文 abc 😀 ').repeat(300000));

console.log(failed ? `FAIL ${failed} of ${count} inputs differ from node:crypto` : `PASS ${count} inputs equal node:crypto`);
process.exit(failed ? 1 : 0);
