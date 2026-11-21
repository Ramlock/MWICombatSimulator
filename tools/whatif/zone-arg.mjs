// The --zone flag, checked against the game's combat zones (actionDetailMap: every action of the combat type, dungeons included).
// Git Bash rewrites an argument that starts with "/" into a Windows path ("/actions/combat/fly" -> "C:/Program Files/Git/actions/combat/fly"),
// so a value that holds "/actions/" after such a prefix is turned back into the zone it names. Anything else is an unknown zone, said
// plainly, instead of a TypeError deep in the engine (src/combatsimulator/zone.js).
import actionDetailMap from '../../src/combatsimulator/data/actionDetailMap.json' with { type: 'json' };

export const COMBAT_ZONES = new Set(Object.values(actionDetailMap).filter((a) => a.type === '/action_types/combat').map((a) => a.hrid));

// value -> the zone hrid it names, from `known` (a Set of hrids). Throws "unknown zone <value>" when it names none.
export function zoneOf(value, known = COMBAT_ZONES) {
    const v = String(value);
    if (known.has(v)) return v;
    const slashed = v.replace(/\\/g, '/'), at = slashed.indexOf('/actions/');
    if (at > 0 && known.has(slashed.slice(at))) return slashed.slice(at);
    const hint = at > 0 || /^[A-Za-z]:/.test(v) ? ' (Git Bash turns an argument starting with "/" into a Windows path: set MSYS_NO_PATHCONV=1)' : '';
    throw new Error(`unknown zone ${v}${hint}`);
}
