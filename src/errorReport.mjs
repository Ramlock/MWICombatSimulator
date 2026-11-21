// What the error window (showErrorModal in src/main.js) shows and copies for an error: its text, as before, and its
// stack when one is known, so a copied error names the line that threw.

// An error a worker posted as `simulation_error` (src/worker.js, src/multiWorker.js). The Error object crosses the
// worker boundary by structured clone, which keeps its stack; anything else (a string) has no stack.
export function workerErrorReport(error) {
    return { message: String(error), stack: error?.stack ?? null };
}

// A `window` "error" event: the thrown error's stack, else the script position the event names, else none.
export function windowErrorReport(event) {
    const stack = event.error?.stack ?? (event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : null);
    return { message: event.message, stack };
}
