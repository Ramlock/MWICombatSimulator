// The window's live boxes (the progress rows, the search rounds) are redrawn at every status poll. Replacing their nodes, or moving a kept node out
// of the document and back, drops the hover of whatever is under the pointer: a button then shows its plain look until the browser's next hover update
// and fades back in through its transition (the stage button flicker), and a help mark's tooltip blinks. So the redraw is made in place: the new
// markup is parsed apart and compared with the box, node by node at the same place; a node of the same kind (the same tag, or text) is kept and only
// its changed attributes and text are written; only a node that differs is replaced. A control whose markup did not change is not touched at all,
// and one whose state changed (disabled, its label, its classes) shows the change at once, in the same node.

// Brings `box`'s children to the markup `html`.
export function morphInto(box, html) {
    const tpl = box.ownerDocument.createElement('template');
    tpl.innerHTML = html;
    morphChildren(box, tpl.content);
}

function morphChildren(old, neu) {
    const a = [...old.childNodes], b = [...neu.childNodes];
    b.forEach((n, i) => {
        const o = a[i];
        if (!o) old.appendChild(n);
        else if (o.nodeType === n.nodeType && o.nodeName === n.nodeName) morphNode(o, n);
        else old.replaceChild(n, o);
    });
    for (let i = b.length; i < a.length; i++) a[i].remove();
}

function morphNode(o, n) {
    if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
    for (const { name } of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name);
    for (const { name, value } of n.attributes) if (o.getAttribute(name) !== value) o.setAttribute(name, value);
    morphChildren(o, n);
}
