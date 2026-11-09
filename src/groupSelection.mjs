// Group import: who to tick and which zone and tier, carried next to the slots in the pasted object.
// `selected` is a list of slot numbers (1-5); `fight` is { zone, tier, kind } (kind: combat | dungeon | labyrinth | idle).
// Both are optional: an older paste with neither imports exactly as before. Values come from the data only; nothing is read back from displayed text.
// A zone or tier the page does not offer is left as it is (reported in `skipped`, never an error).

const SLOT_COUNT = 5;

// Splits a pasted group object into the slot map and the selection. The slot map never contains the two selection keys.
export function splitGroupImport(importMap) {
    const slots = {};
    let selected = null, fight = null;
    for (const key of Object.keys(importMap || {})) {
        if (key === 'selected') selected = importMap[key];
        else if (key === 'fight') fight = importMap[key];
        else slots[key] = importMap[key];
    }
    if (Array.isArray(selected)) {
        const seen = new Set();
        selected = selected.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT && !seen.has(n) && seen.add(n));
    } else {
        selected = null;
    }
    if (!fight || typeof fight !== 'object' || Array.isArray(fight)) fight = null;
    return { slots, selected, fight };
}

const offers = (select, value) => !!select && Array.from(select.options || []).some((o) => o.value === value && !o.disabled);

// Applies the selection to the page, in the order the page needs: the dungeon toggle first (its change handler ticks every
// player and limits the tiers), then the player ticks, then the zone, then the tier. `doc` is the page's document.
export function applyGroupSelection(doc, selection) {
    const out = { ticked: null, dungeon: null, zone: null, tier: null, skipped: [] };
    const selected = selection && selection.selected, fight = selection && selection.fight;
    if (!selected && !fight) return out;
    const get = (id) => doc.getElementById(id);
    const toggle = get('simDungeonToggle'), zoneSelect = get('selectZone'), dungeonSelect = get('selectDungeon'), tierSelect = get('selectDifficulty');
    const zone = fight && typeof fight.zone === 'string' && fight.zone ? fight.zone : null;
    const tier = fight && Number.isInteger(Number(fight.tier)) && fight.tier !== null && fight.tier !== '' ? String(Number(fight.tier)) : null;
    const kind = fight && ['combat', 'dungeon'].includes(fight.kind) ? fight.kind : (zone && offers(dungeonSelect, zone) ? 'dungeon' : (zone && offers(zoneSelect, zone) ? 'combat' : null));

    // 1. the dungeon toggle (only when the fight says which kind it is)
    if (toggle && kind && toggle.checked !== (kind === 'dungeon')) {
        toggle.checked = kind === 'dungeon';
        toggle.dispatchEvent(new Event('change'));
    }
    if (toggle) out.dungeon = !!toggle.checked;

    // 2. the player ticks (the others are unticked)
    if (selected) {
        out.ticked = [];
        for (let n = 1; n <= SLOT_COUNT; n++) {
            const box = get('player' + n);
            if (!box) continue;
            box.checked = selected.includes(n);
            if (box.checked) out.ticked.push(n);
        }
    }

    // 3. the zone (the dungeon list when the toggle is on)
    if (zone) {
        const target = toggle && toggle.checked ? dungeonSelect : zoneSelect;
        if (offers(target, zone)) { target.value = zone; out.zone = zone; }
        else out.skipped.push('zone ' + zone);
    }

    // 4. the tier
    if (tier !== null) {
        if (offers(tierSelect, tier)) { tierSelect.value = tier; out.tier = Number(tier); }
        else out.skipped.push('tier ' + tier);
    }
    return out;
}
