// The optimizer's flags as data, for every shell: the command line (optimize.mjs) turns argv into `flags`, a page would build the same
// object from its form. No file access, no process: the search core (core.mjs) reads its settings only through arg().

// argv -> { name: value | true }. The first occurrence of a flag wins; a flag with no value, or whose next token is another flag, is true.
export function parseFlags(argv) {
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const name = argv[i].slice(2);
        if (name in flags) continue;
        const v = argv[i + 1];
        flags[name] = v === undefined || v.startsWith('--') ? true : v;
    }
    return flags;
}

// arg(name, def): the flag's value; false when only --no-<name> is given; else def.
export const makeArg = (flags) => (name, def) => (name in flags ? flags[name] : ('no-' + name) in flags ? false : def);

// A comma list to an array of trimmed non-empty strings; null when the flag is absent or has no value.
export const list = (v) => (v && v !== true ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);
