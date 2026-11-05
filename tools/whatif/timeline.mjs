// Rates per interval of one run: is the sim stationary over sim time?
// Usage: node tools/whatif/timeline.mjs [--seed 1] [--hours 200] [--step 10] [--comdrop 20 --comexp 20]
// Prints, for each interval, party deaths, deaths/h, income/d and EXP/h within that interval only.
import { runParty } from './engine.mjs';
import { readParty } from './variants.mjs';

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i < 0 ? def : process.argv[i + 1];
}
const SEED = Number(arg('seed', 1)), HOURS = Number(arg('hours', 200)), STEP = Number(arg('step', 10));
const cps = [];
for (let h = STEP; h <= HOURS; h += STEP) cps.push(h);
const r = await runParty({ comdrop: Number(arg('comdrop', 20)), comexp: Number(arg('comexp', 20)), setups: readParty(), seed: SEED, checkpoints: cps });
let prev = { h: 0, deaths: 0, income: 0, exp: 0, enc: 0 };
console.log('| From h | To h | Party deaths | Deaths/h | Encounters/h | Income/d | EXP/h |\n| --- | --- | --- | --- | --- | --- | --- |');
for (const c of r.checkpoints) {
    const h = c.simHours;
    const cur = { h, deaths: c.party.deathsPerHour * h, income: c.party.incomePerDay * h / 24, exp: c.party.expPerHour * h, enc: c.encounters };
    const dh = h - prev.h;
    console.log(`| ${prev.h} | ${h} | ${(cur.deaths - prev.deaths).toFixed(0)} | ${((cur.deaths - prev.deaths) / dh).toFixed(3)} | ${((cur.enc - prev.enc) / dh).toFixed(1)} | ${((cur.income - prev.income) / dh * 24 / 1e6).toFixed(2)}M | ${((cur.exp - prev.exp) / dh / 1e3).toFixed(1)}K |`);
    prev = cur;
}
console.log(`\nseed ${SEED}, ${HOURS} h, wall ${r.wallSeconds.toFixed(0)} s`);
