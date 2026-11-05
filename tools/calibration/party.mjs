// The party's names come from the private setups folder (docs/ground-truth/setups, gitignored), never from the code:
// in the order its party.txt lists (one name per line), else every <name>.json there, sorted by name.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SETUPS_DIR = path.resolve(here, '..', '..', 'docs', 'ground-truth', 'setups');

export function partyNames(dir = SETUPS_DIR) {
    if (!existsSync(dir)) return [];
    const order = path.join(dir, 'party.txt');
    if (existsSync(order)) return readFileSync(order, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}
