// The short real search a built runner is tested with (tools/test/whatif-runner-exe.mjs, tools/release/zip-search.mjs): two
// synthetic players, the equipment lever, two small stages. runSearch(port) posts it to the runner on 127.0.0.1:<port> and
// resolves the search's last state ({ state, result, error }) once it stops running, or after 10 minutes.
export const searchRequest = {
    setups: ['Alpha', 'Beta'].map((name, i) => ({ name, guildCombatBuffLevels: {}, achievements: {}, houseRooms: {}, triggerMap: {},
        player: { staminaLevel: 40, intelligenceLevel: 40, attackLevel: 40, meleeLevel: 40, defenseLevel: 40, rangedLevel: 40, magicLevel: 40, equipment: [
            { itemLocationHrid: '/item_locations/main_hand', itemHrid: i ? '/items/cheese_mace' : '/items/cheese_sword', enhancementLevel: 0 },
            { itemLocationHrid: '/item_locations/head', itemHrid: '/items/cheese_helmet', enhancementLevel: 0 }] },
        abilities: [null, null, null, null, null], food: { '/action_types/combat': [] }, drinks: { '/action_types/combat': [] } })),
    options: { zone: '/actions/combat/fly', tier: 0, comdrop: 0, comexp: 0, prices: 'marketplace-2026-11-03.json' },
    goal: 'profit', budgets: { Alpha: 1e9, Beta: 0 }, levers: ['equip'], stages: ['4x2', '4x2'], keep: [4], maxUp: 2, swaps: false, z: 0,
};

export async function runSearch(port) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const st = await (await fetch(`http://127.0.0.1:${port}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(searchRequest) })).json();
    let r = null; const ts = Date.now();
    while (Date.now() - ts < 600000) { r = await (await fetch(`http://127.0.0.1:${port}/api/search/${st.id}`)).json(); if (r.state !== 'running') break; await sleep(1000); }
    return r;
}
