// Test: the public fork's tracked code holds no party name. With the private setups copied in (docs/ground-truth/setups,
// party.txt included), no tracked file under tools/, src/ or docs/ holds a party name as a whole word, except the
// repository owner in the runner release addresses and the patch note's translation label.
// Also: defaultPlayer (tools/calibration/party.mjs) is the party's first name. With no setups present the scan is skipped.
// Usage: node tools/test/no-party-names.mjs   Exit code 0 on pass (or skip), 1 on fail.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partyNames, defaultPlayer } from '../calibration/party.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) failed++; };

check('defaultPlayer: the first name', defaultPlayer(['Aaa', 'Bbb']) === 'Aaa');
let threw = false; try { defaultPlayer([]); } catch { threw = true; }
check('defaultPlayer: no party throws', threw);

const names = partyNames();
if (!names.length) {
    console.log('SKIPPED the scan: no setups in docs/ground-truth/setups');
} else {
    const files = execFileSync('git', ['ls-files', '-z', '--', 'tools', 'src', 'docs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    // The allowed public uses, each by its exact text: the owner's release addresses and the patch note's translation credit.
    const ALLOWED = (n) => [`https://github.com/${n}/MWICombatSimulator/releases/latest/download/`, `Machine translation by ${n}"`, `机器翻译（${n} 提供）`, `Tradução automática por ${n}"`];
    const allowed = (line, n) => ALLOWED(n).reduce((l, a) => l.split(a).join(''), line);
    const hits = [];
    for (const f of files) {
        let text; try { text = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
        text.split(/\r?\n/).forEach((line, i) => names.forEach((n, k) => {
            const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(String.raw`(?<![\p{L}\p{N}_])${esc}(?![\p{L}\p{N}_])`, 'iu').test(allowed(line, n))) hits.push(`${f}:${i + 1} (party member ${k + 1})`);
        }));
    }
    check(`no party name in ${files.length} tracked files`, hits.length === 0, '\n  ' + hits.join('\n  '));
}
process.exit(failed ? 1 : 0);
