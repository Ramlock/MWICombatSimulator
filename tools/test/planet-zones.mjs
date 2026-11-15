// Test: isPlanetZone, the one test for a planet (an area's group fight), on the fork's game data: 11 zones, no dungeon, no single-monster fight.
// Usage: node tools/test/planet-zones.mjs        Exit code 0 on pass, 1 on fail.
import fs from 'node:fs';
import { isPlanetZone } from '../../src/zones.mjs';
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };
const actions = Object.values(JSON.parse(fs.readFileSync(new URL('../../src/combatsimulator/data/actionDetailMap.json', import.meta.url))));
const planets = actions.filter(isPlanetZone);
check('11 planets', planets.length === 11, String(planets.length));
check('no dungeon', planets.every((a) => a.category !== '/action_categories/combat/dungeons'));
check('no single-monster fight', planets.every((a) => a.combatZoneInfo.fightInfo.randomSpawnInfo.maxSpawnCount > 1));
check('every planet is a combat action', planets.every((a) => a.type === '/action_types/combat'));
const combat = actions.filter((a) => a.type === '/action_types/combat' && a.category !== '/action_categories/combat/dungeons');
check('some zones are not planets', combat.length > planets.length);
check('a non-combat action is not a planet', !isPlanetZone({ type: '/action_types/milking' }));
process.exit(failed ? 1 : 0);
