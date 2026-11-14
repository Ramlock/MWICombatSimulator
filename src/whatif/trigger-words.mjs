// The one wording of a trigger change, for the runner and the window. The runner words a change with EN and no game names: that is the
// change's text in a result (its desc, "<owner> trigger: <change>"), and the form the window reads back (readChange). The window words the
// same change with its own strings (the page's language) and the game's official names (js/i18n.js, through namesFrom).
// A term: { dep, cond, cmp, value? } (the last part of each game id: dependency, condition, comparator; value only for >= and <=).
// A change: { kind: 'list', terms } (that list; empty: always) | { kind: 'default', terms } (the game's default list) | { kind: 'drop', term }
// | { kind: 'add', term } | { kind: 'set', term, to: { cmp?, value } } (one term's value, and its comparator when it flips).
// words: { trigger, always, and, then, gameDefault, drop, add }; the last three hold {x}, where the list or the term goes.
export const EN = { trigger: 'trigger', always: 'always', and: 'AND', then: 'then', gameDefault: 'game default ({x})', drop: 'drop {x}', add: 'add {x}' };
const SIGN = { greater_than_equal: '>=', less_than_equal: '<=' };
const SIGNED = { '>=': 'greater_than_equal', '<=': 'less_than_equal' };
const noNames = () => null;
const fill = (template, x) => String(template).replace('{x}', x);
// names(kind, slug): the game's word for a dependency ('dep'), condition ('cond') or comparator ('cmp'), or null (the id is shown).
export const termWords = (t, names = noNames) => [names('dep', t.dep) ?? t.dep, names('cond', t.cond) ?? t.cond, SIGN[t.cmp] ?? names('cmp', t.cmp) ?? t.cmp, ...(t.value !== undefined ? [t.value] : [])].join(' ');
export const listWords = (ts, w = EN, names = noNames) => (ts.length ? ts.map((t) => termWords(t, names)).join(` ${w.and} `) : w.always);
export function changeWords(c, w = EN, names = noNames) {
    if (c.kind === 'default') return fill(w.gameDefault, listWords(c.terms, w, names));
    if (c.kind === 'drop') return fill(w.drop, termWords(c.term, names));
    if (c.kind === 'add') return fill(w.add, termWords(c.term, names));
    if (c.kind === 'set') return `${termWords(c.term, names)} -> ${c.to.cmp ? SIGN[c.to.cmp] + ' ' : ''}${c.to.value}`;
    return listWords(c.terms, w, names);
}
// A game trigger term ({ dependencyHrid, conditionHrid, comparatorHrid, value }) as a term; `numeric`: its value counts (>= and <=).
const slug = (hrid) => String(hrid).split('/').pop();
export const termOf = (t) => ({ dep: slug(t.dependencyHrid), cond: slug(t.conditionHrid), cmp: slug(t.comparatorHrid), ...(SIGN[slug(t.comparatorHrid)] ? { value: t.value } : {}) });

// Reading the runner's text back (changeWords with EN): a change, or null when the text is not one (it is then shown as it is).
const ID = /^[a-z][a-z0-9_]*$/;
function readTerm(s) {
    const p = String(s).trim().split(' ');
    if (p.length < 3 || p.length > 4 || !ID.test(p[0]) || !ID.test(p[1])) return null;
    const signed = SIGNED[p[2]];
    if (signed) return p.length === 4 && p[3] !== '' && Number.isFinite(Number(p[3])) ? { dep: p[0], cond: p[1], cmp: signed, value: Number(p[3]) } : null;
    return p.length === 3 && ID.test(p[2]) ? { dep: p[0], cond: p[1], cmp: p[2] } : null;
}
export function readList(s) {
    if (s === EN.always) return [];
    const ts = String(s).split(` ${EN.and} `).map(readTerm);
    return ts.every(Boolean) ? ts : null;
}
export function readChange(s) {
    let m;
    if ((m = /^game default \((.*)\)$/.exec(s))) { const terms = readList(m[1]); return terms && { kind: 'default', terms }; }
    if ((m = /^(drop|add) (.*)$/.exec(s))) { const term = readTerm(m[2]); return term && { kind: m[1], term }; }
    if ((m = /^(.*) -> (?:(>=|<=) )?(-?[0-9.]+)$/.exec(s))) { const term = readTerm(m[1]); return term && { kind: 'set', term, to: { ...(m[2] ? { cmp: SIGNED[m[2]] } : {}), value: Number(m[3]) } }; }
    const terms = readList(s);
    return terms && { kind: 'list', terms };
}
