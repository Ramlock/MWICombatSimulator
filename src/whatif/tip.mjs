// The window's help marks (span.whatif-help, their sentence in data-tip) share one tooltip, div.whatif-tip, a child of the window's root (#whatIfModal)
// drawn with position: fixed. A tooltip drawn inside the mark (a ::after) was cut by any box around it that hides its overflow (a stage list cell)
// and could add a scrollbar near the window's edge; this one stands over everything in the window wherever the mark is.
// It shows on the mark's hover or keyboard focus, under the mark, left-aligned with it, and stays inside the window (.modal-content, cut to the
// screen): moved left when it would pass the right edge, put above the mark when there is no room below. While it shows, it follows the mark at
// every frame (a scroll, a redraw that changed the mark's sentence) and hides once the mark has neither hover nor focus, or has left the page.
export function attachTips(root) {
    const doc = root.ownerDocument, win = doc.defaultView;
    const tip = doc.createElement('div');
    tip.className = 'whatif-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    root.appendChild(tip);
    let anchor = null, frame = 0;
    const hide = () => { anchor = null; tip.hidden = true; if (frame) win.cancelAnimationFrame(frame); frame = 0; };
    const place = () => {
        frame = 0;
        if (!anchor) return;
        if (!anchor.isConnected || !anchor.offsetParent || !(anchor.matches(':hover') || anchor === doc.activeElement)) { hide(); return; }
        const text = anchor.dataset.tip || '';
        if (tip.textContent !== text) tip.textContent = text;
        const pad = 8, gap = 6, rem = parseFloat(win.getComputedStyle(doc.documentElement).fontSize) || 16;
        const box = (root.querySelector('.modal-content') || root).getBoundingClientRect(), a = anchor.getBoundingClientRect();
        const left = Math.max(box.left, 0) + pad, right = Math.min(box.right, win.innerWidth) - pad, top = Math.max(box.top, 0) + pad, bottom = Math.min(box.bottom, win.innerHeight) - pad;
        tip.style.maxWidth = Math.max(0, Math.min(26 * rem, right - left)) + 'px';
        const t = tip.getBoundingClientRect();
        const x = Math.max(left, Math.min(a.left, right - t.width));
        const below = a.bottom + gap, above = a.top - gap - t.height;
        const y = below + t.height <= bottom || above < top ? Math.min(below, bottom - t.height) : above;
        tip.style.left = x + 'px';
        tip.style.top = Math.max(top, y) + 'px';
        frame = win.requestAnimationFrame(place);
    };
    const show = (event) => {
        const mark = event.target.closest?.('.whatif-help');
        if (!mark || !mark.dataset.tip || mark === anchor) return;
        anchor = mark;
        tip.hidden = false;
        if (frame) win.cancelAnimationFrame(frame);
        place();
    };
    root.addEventListener('mouseover', show);
    root.addEventListener('focusin', show);
}
