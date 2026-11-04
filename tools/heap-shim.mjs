// webpack hands `import Heap from "heap-js"` the Heap class; Node's CJS interop hands the whole module object. This shim restores the class.
import { createRequire } from "node:module";
const m = createRequire(import.meta.url)("heap-js");
export default m.Heap ?? m.default ?? m;
