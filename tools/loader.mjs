// Node ESM loader hooks so the simulator's browser-bundled sources run headless under Node.
// - resolves extensionless relative imports ("./ability" -> "./ability.js")
// - turns "*.json" imports into default-export modules (the webpack JSON behaviour)
// - marks src/**/*.js as ESM (package.json has no "type": "module")
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
    if (specifier === "heap-js") {
        return { url: new URL("./heap-shim.mjs", import.meta.url).href, shortCircuit: true };
    }
    try {
        return await nextResolve(specifier, context);
    } catch (err) {
        if (err.code === "ERR_MODULE_NOT_FOUND" && (specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
            return nextResolve(specifier + ".js", context);
        }
        throw err;
    }
}

export async function load(url, context, nextLoad) {
    if (url.endsWith(".json") && url.startsWith("file:")) {
        const text = readFileSync(fileURLToPath(url), "utf8");
        return { format: "module", source: "export default " + text + ";", shortCircuit: true };
    }
    if (url.endsWith(".js") && url.includes("/src/") && url.startsWith("file:") && existsSync(fileURLToPath(url))) {
        return { format: "module", source: readFileSync(fileURLToPath(url), "utf8"), shortCircuit: true };
    }
    return nextLoad(url, context);
}
