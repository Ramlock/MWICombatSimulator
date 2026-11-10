// The XP-vs-profit chart of the all-zones result dialog: the selectors, the Chart.js scatter and the click-to-row highlight.
// It draws from the display rows it is given (never from the table cells) and finds table rows by the data attributes
// `updateAllSimsModal` writes (data-map-key, data-player), never by cell text.
import { PARTY, XP_KEYS, pointsFor, frontier, playersOf } from "./xpChart.mjs";

// Table header texts, by XP key: the chart's X axis title uses the table's own header keys.
const X_TITLE_KEYS = {
    TotalExperience: 'common:simulationResults.totalExperience',
    Stamina: 'skillNames./skills/stamina', Intelligence: 'skillNames./skills/intelligence', Attack: 'skillNames./skills/attack',
    Melee: 'skillNames./skills/melee', Defense: 'skillNames./skills/defense', Ranged: 'skillNames./skills/ranged', Magic: 'skillNames./skills/magic',
};
const COLORS = { frontier: 'rgb(255, 193, 7)', frontierLine: 'rgba(255, 193, 7, 0.7)', dim: 'rgba(160, 170, 185, 0.55)', text: '#f0f0f0', grid: 'rgba(255, 255, 255, 0.12)' };

// deps: { t(key), format(number), Chart }. Returns { setRows, redraw, clearHighlight }.
export function createXpChartView({ t, format, Chart }) {
    const $ = (id) => document.getElementById(id);
    const panel = $('xpChartPanel'), canvas = $('xpChartCanvas'), skillSelect = $('xpChartSkill'), playerSelect = $('xpChartPlayer');
    let rows = [], chart = null, points = [];

    // The X axis and the tooltip say what the values are per: the skill's name as the table has it, then "per hour".
    const xLabel = (xKey) => `${t(X_TITLE_KEYS[xKey])}${xKey === 'TotalExperience' ? '' : ' ' + t('common:xpChart.xp')} ${t('common:xpChart.perHour')}`;
    const mapName = (zone) => {
        const s = String(zone);
        if (s.startsWith('/action')) return t('actionNames.' + s);
        if (s.startsWith('/monsters')) return t('monsterNames.' + s);
        return s;
    };

    function clearHighlight() {
        document.querySelectorAll('#allZonesData tr.xp-chart-picked').forEach((tr) => tr.classList.remove('xp-chart-picked'));
    }

    // Scrolls to and marks the table rows of the clicked dot: every player row of the map for Party, that player's row otherwise.
    function pick(point) {
        clearHighlight();
        const player = playerSelect.value;
        const hit = [...document.querySelectorAll('#allZonesData tbody tr')].filter((tr) => tr.dataset.mapKey === point.key && (player === PARTY || tr.dataset.player === player));
        hit.forEach((tr) => tr.classList.add('xp-chart-picked'));
        hit[0]?.scrollIntoView({ block: 'center' });
    }

    function fillSelectors() {
        const keep = skillSelect.value;
        skillSelect.innerHTML = '';
        for (const key of XP_KEYS) {
            const o = document.createElement('option');
            o.value = key;
            o.textContent = t(key === 'TotalExperience' ? 'common:total' : X_TITLE_KEYS[key]);
            skillSelect.appendChild(o);
        }
        if (keep) skillSelect.value = keep;
        const keepPlayer = playerSelect.value;
        playerSelect.innerHTML = '';
        for (const p of [PARTY, ...playersOf(rows)]) {
            const o = document.createElement('option');
            o.value = p;
            o.textContent = p === PARTY ? t('common:xpChart.party') : p;
            playerSelect.appendChild(o);
        }
        if ([...playerSelect.options].some((o) => o.value === keepPlayer)) playerSelect.value = keepPlayer;
    }

    function redraw() {
        if (!panel || panel.classList.contains('d-none')) return;
        const xKey = skillSelect.value || XP_KEYS[0];
        points = pointsFor(rows, { xKey, player: playerSelect.value || PARTY });
        const front = frontier(points);
        const onFront = new Set(front);
        const dot = (p) => ({ x: p.x, y: p.y, point: p });
        const data = {
            datasets: [
                { label: 'frontier', data: front.map(dot), showLine: true, borderColor: COLORS.frontierLine, backgroundColor: COLORS.frontier, pointBackgroundColor: COLORS.frontier, pointBorderColor: COLORS.frontier, pointRadius: 5, pointHoverRadius: 7, borderWidth: 2 },
                { label: 'others', data: points.filter((p) => !onFront.has(p)).map(dot), showLine: false, backgroundColor: 'rgba(0, 0, 0, 0)', pointBackgroundColor: 'rgba(0, 0, 0, 0)', pointBorderColor: COLORS.dim, pointRadius: 4, pointHoverRadius: 6, borderWidth: 1.5 },
            ],
        };
        const axis = (text) => ({ title: { display: true, text, color: COLORS.text }, ticks: { color: COLORS.text, callback: (v) => format(v) }, grid: { color: COLORS.grid } });
        const options = {
            responsive: true, maintainAspectRatio: false, animation: false,
            scales: { x: axis(xLabel(xKey)), y: axis(t('common:xpChart.profitPerDay')) },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        title: (items) => mapName(items[0].raw.point.zone),
                        label: (item) => {
                            const p = item.raw.point;
                            return [`${t('party.difficulty')}: ${p.tier}`, `${xLabel(xKey)}: ${format(p.x)}`, `${t('common:xpChart.profitPerDay')}: ${format(p.y)}`, `${t('common:simulationResults.deathPerHour')}: ${format(p.deaths)}`];
                        },
                    },
                },
            },
            onClick: (event, elements) => { if (elements.length) pick(elements[0].element.$context.raw.point); },
        };
        if (chart) { chart.data = data; chart.options = options; chart.update(); }
        else chart = new Chart(canvas, { type: 'scatter', data, options });
    }

    // rows: the display rows of the result; hidden for a Labyrinth result.
    function setRows(newRows, isLabyrinth) {
        rows = newRows;
        clearHighlight();
        panel?.classList.toggle('d-none', !!isLabyrinth);
        if (isLabyrinth) { chart?.destroy(); chart = null; return; }
        fillSelectors();
        redraw();
    }

    skillSelect?.addEventListener('change', () => { clearHighlight(); redraw(); });
    playerSelect?.addEventListener('change', () => { clearHighlight(); redraw(); });
    document.getElementById('allSimsModal')?.addEventListener('hidden.bs.modal', clearHighlight);
    return { setRows, redraw, clearHighlight, refreshLabels: () => { if (rows.length) { fillSelectors(); redraw(); } } };
}
