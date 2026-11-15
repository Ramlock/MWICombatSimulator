// The default player of every tool: the party's first name (party.txt's first line, else the first setup by name). Pure (no file reads), so the page
// search bundles it; party.mjs gives it the names from the setups folder.
export function defaultPlayer(names) {
    if (!names.length) throw new Error('no party: copy the setups into docs/ground-truth/setups (party.txt lists the names), or name the player');
    return names[0];
}
