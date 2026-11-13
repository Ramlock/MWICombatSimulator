// SHA-1 of a text as lowercase hex, synchronous, for the page (crypto.subtle is async and the search core's `hash` seam is synchronous: the
// run keys, core.mjs keyOf). Same result as node:crypto createHash('sha1').update(text).digest('hex'): the text is read as UTF-8 (a lone
// surrogate becomes U+FFFD in both). No node: module; tools/test/whatif-sha1.mjs checks it against node:crypto.
export function sha1(text) {
    const bytes = new TextEncoder().encode(String(text));
    const n = bytes.length;
    const total = Math.ceil((n + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[n] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, Math.floor((n * 8) / 4294967296));
    view.setUint32(total - 4, (n * 8) >>> 0);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Int32Array(80);
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getInt32(off + i * 4);
        for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
        let a = h0, b = h1, c = h2, d = h3, e = h4;
        for (let i = 0; i < 80; i++) {
            let f, k;
            if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
            else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
            else { f = b ^ c ^ d; k = 0xca62c1d6; }
            const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
            e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}
