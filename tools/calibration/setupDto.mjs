// The player DTO the UI builds from a ground-truth setup file (docs/ground-truth/setups/<name>.json):
// doSoloImport (src/main.js) then buildSimPlayerDTO / startSimulation. Needs hooks.mjs registered first.
// The Node side: `root`, the src path helper and the setup file read. The DTO builder itself is setupDto-pure.mjs, which a bundler loads too.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..', '..');
export const src = (p) => new URL('file:///' + path.join(root, 'src', p).replace(/\\/g, '/')).href;

export { buildDto, fixTriggerMap, calcCombatLevel } from './setupDto-pure.mjs';

export function readSetup(name) {
    return JSON.parse(readFileSync(path.join(root, 'docs', 'ground-truth', 'setups', name + '.json'), 'utf8'));
}
