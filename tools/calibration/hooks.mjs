// Node module hooks so the engine under src/ (written for webpack) loads in plain Node:
// extensionless relative imports resolve to .js, JSON imports become ES modules,
// and src/*.js is always treated as ESM.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC_MARK = '/src/';

export async function resolve(specifier, context, nextResolve) {
    // heap-js loads as CommonJS in Node; webpack's interop hands the engine the Heap class as default.
    if (specifier === 'heap-js' && context.parentURL?.includes(SRC_MARK)) {
        return { url: new URL('./heap-shim.mjs', import.meta.url).href, shortCircuit: true };
    }
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL && !/\.(c|m)?js$|\.json$/.test(specifier)) {
        const candidate = new URL(specifier + '.js', context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
            return nextResolve(candidate.href, context);
        }
    }
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.includes(SRC_MARK)) {
        if (url.endsWith('.json')) {
            const source = await readFile(fileURLToPath(url), 'utf8');
            return { format: 'module', source: `export default ${source};`, shortCircuit: true };
        }
        if (url.endsWith('.js')) {
            const source = await readFile(fileURLToPath(url), 'utf8');
            return { format: 'module', source, shortCircuit: true };
        }
    }
    return nextLoad(url, context);
}
