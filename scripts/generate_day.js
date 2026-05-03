const fs = require('fs');
const path = require('path');

// Configuration
const MAX_DAYS = 365;
const INITIAL_DAYS = 5;
const DATA_DIR = path.join(__dirname, '../data');
const ASSETS_DIR = path.join(__dirname, '../assets');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// --- Real Data & Metric Logic ---

const TRACKED_REPOS = [
    { owner: 'electricitymaps', repo: 'electricitymaps-contrib', label: 'Electricity Maps' },
    { owner: 'openclimatefix', repo: 'Open-Source-Quartz-Solar-Forecast', label: 'Open Climate Fix' },
    { owner: 'protontypes', repo: 'open-sustainable-technology', label: 'OpenSustain.tech' },
    { owner: 'fathomnet', repo: 'fathomnet-py', label: 'FathomNet' },
    { owner: 'publiclab', repo: 'plots2', label: 'Public Lab' },
    { owner: 'greenpeace', repo: 'planet4-master-theme', label: 'Greenpeace Planet 4' },
];

let globalCommitData = { recent: [] };

async function fetchAllCommits() {
    console.log('Fetching real commit data...');
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceISO = since.toISOString();

    const fetches = TRACKED_REPOS.map(async (r) => {
        try {
            const url = `https://api.github.com/repos/${r.owner}/${r.repo}/commits?since=${sinceISO}&per_page=100`;
            const res = await fetch(url, { headers: { 'User-Agent': 'Grove-Bot' } });
            if (!res.ok) return [];
            const data = await res.json();
            return data.map(c => ({
                repo: r.label,
                date: c.commit.author.date
            }));
        } catch (e) {
            console.warn(`Error fetching ${r.label}:`, e.message);
            return [];
        }
    });

    const results = await Promise.all(fetches);
    const flat = results.flat();
    globalCommitData.recent = flat;
    console.log(`Fetched ${flat.length} total commits from tracked repos.`);
}

// =====================================================
// Real Environmental Data Fetchers (all free, no API key)
// =====================================================

// 1. Air Quality Index — Open-Meteo Air Quality (6-city global average)
async function fetchAirQualityData() {
    const cities = [
        { lat: 40.7128,  lon: -74.006  }, // New York
        { lat: 48.8566,  lon:   2.3522 }, // Paris
        { lat: 51.5074,  lon:  -0.1278 }, // London
        { lat: 35.6762,  lon: 139.6503 }, // Tokyo
        { lat: 19.076,   lon:  72.8777 }, // Mumbai
        { lat: -23.5505, lon: -46.6333 }, // São Paulo
    ];
    try {
        const results = await Promise.all(cities.map(async (c) => {
            const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${c.lat}&longitude=${c.lon}&current=us_aqi`;
            const res = await fetch(url, { headers: { 'User-Agent': 'Grove-Bot' } });
            if (!res.ok) return null;
            const data = await res.json();
            return data.current?.us_aqi ?? null;
        }));
        const valid = results.filter(v => v !== null);
        if (valid.length === 0) return null;
        return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    } catch (e) {
        console.warn('AQI fetch error:', e.message);
        return null;
    }
}

// 2. Atmospheric CO₂ (ppm) — NOAA Mauna Loa daily text file
async function fetchCO2Data() {
    try {
        const url = 'https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.txt';
        const res = await fetch(url, { headers: { 'User-Agent': 'Grove-Bot' } });
        if (!res.ok) return null;
        const text = await res.text();
        const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        for (let i = lines.length - 1; i >= 0; i--) {
            const parts = lines[i].trim().split(/\s+/);
            const ppm = parseFloat(parts[4]);
            if (!isNaN(ppm) && ppm > 0) return parseFloat(ppm.toFixed(2));
        }
        return null;
    } catch (e) {
        console.warn('CO₂ fetch error:', e.message);
        return null;
    }
}

// 3. Solar Irradiance (W/m²) — Open-Meteo Forecast (daily average, global lat/lon)
async function fetchSolarData() {
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=20&longitude=0&hourly=shortwave_radiation&forecast_days=1&timezone=UTC';
        const res = await fetch(url, { headers: { 'User-Agent': 'Grove-Bot' } });
        if (!res.ok) return null;
        const data = await res.json();
        const vals = (data.hourly?.shortwave_radiation ?? []).filter(v => v !== null);
        if (vals.length === 0) return null;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    } catch (e) {
        console.warn('Solar fetch error:', e.message);
        return null;
    }
}

// 4. Sea Surface Temperature (°C) — Open-Meteo Marine API (equatorial Pacific)
async function fetchOceanData() {
    try {
        const url = 'https://marine-api.open-meteo.com/v1/marine?latitude=0&longitude=-140&current=sea_surface_temperature,wave_height';
        const res = await fetch(url, { headers: { 'User-Agent': 'Grove-Bot' } });
        if (!res.ok) return null;
        const data = await res.json();
        const sst = data.current?.sea_surface_temperature ?? null;
        const wave = data.current?.wave_height ?? null;
        return (sst !== null) ? { sst: parseFloat(sst.toFixed(1)), wave } : null;
    } catch (e) {
        console.warn('Ocean fetch error:', e.message);
        return null;
    }
}

// 5. Species Observations — GBIF global occurrence count (no key)
async function fetchSpeciesData() {
    try {
        const url = 'https://api.gbif.org/v1/occurrence/search?limit=0';
        const res = await fetch(url, { headers: { 'User-Agent': 'Grove-Bot/1.0 (grove-project)' } });
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.count === 'number' ? data.count : null;
    } catch (e) {
        console.warn('GBIF fetch error:', e.message);
        return null;
    }
}

// 6. Vegetation Health — Open-Meteo ET₀ (evapotranspiration, rainforest zones)
async function fetchVegetationData() {
    const points = [
        { lat: 0,  lon:  25 }, // Congo Basin
        { lat: -3, lon: -60 }, // Amazon
        { lat: 5,  lon: 105 }, // Borneo
    ];
    try {
        const results = await Promise.all(points.map(async (p) => {
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&daily=et0_fao_evapotranspiration&forecast_days=1&timezone=UTC`;
            const res = await fetch(url, { headers: { 'User-Agent': 'Grove-Bot' } });
            if (!res.ok) return null;
            const data = await res.json();
            const val = data.daily?.et0_fao_evapotranspiration?.[0];
            return typeof val === 'number' ? val : null;
        }));
        const valid = results.filter(v => v !== null);
        if (valid.length === 0) return null;
        return parseFloat((valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2));
    } catch (e) {
        console.warn('Vegetation fetch error:', e.message);
        return null;
    }
}

// Orchestrator — runs all fetchers in parallel
async function fetchAllClimateData() {
    console.log('Fetching real environmental data...');
    const [air, co2, solar, ocean, species, vegetation] = await Promise.allSettled([
        fetchAirQualityData(),
        fetchCO2Data(),
        fetchSolarData(),
        fetchOceanData(),
        fetchSpeciesData(),
        fetchVegetationData(),
    ]);
    const result = {
        air:        air.status        === 'fulfilled' ? air.value        : null,
        co2:        co2.status        === 'fulfilled' ? co2.value        : null,
        solar:      solar.status      === 'fulfilled' ? solar.value      : null,
        ocean:      ocean.status      === 'fulfilled' ? ocean.value      : null,
        species:    species.status    === 'fulfilled' ? species.value    : null,
        vegetation: vegetation.status === 'fulfilled' ? vegetation.value : null,
    };
    console.log('Climate data:', JSON.stringify(result));
    return result;
}

function seededRand(seed) {
    const s = Math.sin(seed) * 43758.5453;
    return s - Math.floor(s);
}

// --- Real Data Integration (Matches index.html) ---
const START_DATE = new Date();
START_DATE.setDate(START_DATE.getDate() - 30);

function getCommitsForDay(dayIndex) {
    if (!globalCommitData || !globalCommitData.recent) return 0;
    const targetDate = new Date(START_DATE);
    targetDate.setDate(targetDate.getDate() + dayIndex);
    const dateStr = targetDate.toDateString();

    return globalCommitData.recent.filter(c => {
        return new Date(c.date).toDateString() === dateStr;
    }).length;
}

function generateDayData(day) {
    const realCommits = getCommitsForDay(day);
    const activity = realCommits > 0 ? realCommits : 0;

    const r = seededRand(day * 127.1 + 311.7);

    // Base values (natural growth)
    const baseTrees = 100 + r * 50;
    const baseCO2 = 5 + r * 2;
    const baseRenew = 2 + r * 2;

    // Impact multipliers
    const trees = Math.floor(baseTrees + activity * 500);
    const co2 = Math.floor(baseCO2 + activity * 20);
    const renewable = Math.floor(baseRenew + activity * 10);
    const ocean = Math.max(0, parseFloat((0.1 + activity * 0.5 + r * 0.2).toFixed(1)));
    const air = Math.min(150, Math.floor(20 + activity * 5 + r * 10)); // AQI
    const wildlife = Math.min(100, parseFloat((10 + activity * 2 + r * 5).toFixed(1)));

    const tS = Math.min(1, trees / 5000);
    const cS = Math.min(1, co2 / 200);
    const rS = Math.min(1, renewable / 100);
    const oS = Math.min(1, ocean / 10);
    const aS = Math.min(1, air / 50);
    const wS = wildlife / 100;
    const score = Math.min(1, (tS + cS + rS + oS + aS + wS) / 6);

    const date = new Date(START_DATE);
    date.setDate(date.getDate() + day);

    return {
        day, score, trees, co2, renewable, ocean, air, wildlife,
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        treesPct: Math.min(100, (trees / 5000) * 100),
        co2Pct: Math.min(100, (co2 / 200) * 100),
        renewPct: Math.min(100, (renewable / 100) * 100),
        oceanPct: Math.min(100, (ocean / 10) * 100),
        airPct: Math.min(100, (air / 50) * 100),
        wildPct: Math.min(100, wildlife),
        scoreLabel: score > 0.75 ? 'Excellent' : score > 0.55 ? 'Good' : score > 0.35 ? 'Moderate' : score > 0.2 ? 'Below avg' : 'Poor',
    };
}

function scoreToColor(score) {
    if (score > 0.75) return '#22c55e';
    if (score > 0.55) return '#84cc16';
    if (score > 0.35) return '#eab308';
    if (score > 0.2) return '#f97316';
    return '#a16207';
}

function buildTreeStructure() {
    const all = [];
    function branch(x, y, angle, length, depth, maxD) {
        if (depth > maxD || length < 3) return;
        const ex = x + Math.cos(angle) * length;
        const ey = y + Math.sin(angle) * length;
        all.push({ x1: x, y1: y, x2: ex, y2: ey, depth, length });
        const r1 = seededRand(x * 12.9898 + y * 78.233 + depth * 45.164);
        const r2 = seededRand(x * 63.7264 + y * 10.873 + depth * 91.42);
        const spread = 0.35 + r1 * 0.25, shrink = 0.62 + r2 * 0.12, asym = (r1 - 0.5) * 0.12;
        branch(ex, ey, angle - spread + asym, length * shrink, depth + 1, maxD);
        branch(ex, ey, angle + spread + asym, length * (shrink - 0.02), depth + 1, maxD);
        if (r2 > 0.65 && depth < maxD - 1) branch(ex, ey, angle + (r1 - 0.5) * 0.8, length * shrink * 0.7, depth + 1, maxD);
    }
    branch(400, 580, -Math.PI / 2, 110, 0, 10);
    return all;
}

const COMMON_DEFS = `
  <defs>
    <radialGradient id="glow" cx="50%" cy="100%" r="60%"><stop offset="0%" stop-color="rgba(74,222,128,0.06)" /><stop offset="100%" stop-color="transparent" /></radialGradient>
    <linearGradient id="grad-trees" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#166534"/><stop offset="100%" stop-color="#22c55e"/></linearGradient>
    <linearGradient id="grad-co2" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#1e3a5f"/><stop offset="100%" stop-color="#38bdf8"/></linearGradient>
    <linearGradient id="grad-renew" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#713f12"/><stop offset="100%" stop-color="#eab308"/></linearGradient>
    <linearGradient id="grad-ocean" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#164e63"/><stop offset="100%" stop-color="#06b6d4"/></linearGradient>
    <linearGradient id="grad-air" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#3b0764"/><stop offset="100%" stop-color="#a855f7"/></linearGradient>
    <linearGradient id="grad-wild" x1="0" x2="1" y1="0" y2="0"><stop offset="0%" stop-color="#7c2d12"/><stop offset="100%" stop-color="#f97316"/></linearGradient>
    <filter id="soft-glow"><feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
    <style>
      .serif { font-family: 'DM Serif Display', serif; }
      .mono { font-family: 'IBM Plex Mono', monospace; }
      .text-dim { fill: #5a6e60; }
      .text-accent { fill: #4ade80; }
      .text-base { fill: #c8d6ce; }
      .card-bg { fill: #0f1512; stroke: rgba(74, 222, 128, 0.08); stroke-width: 1px; }
    </style>
  </defs>
`;

function writeSVG(filename, width, height, content) {
    const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    ${COMMON_DEFS}
    ${content}
  </svg>`;
    fs.writeFileSync(path.join(ASSETS_DIR, filename), svg);
    console.log(`Generated assets/${filename}`);
}



// --- Main Execution ---

(async function main() {
    await fetchAllCommits();
    const climateData = await fetchAllClimateData();

    // Data Generation
    const args = process.argv.slice(2);
    const renderOnly = args.includes('--render-only');

    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
    let lastDay = -1;
    if (files.length > 0) {
        const lastFile = files[files.length - 1];
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, lastFile), 'utf8'));
        lastDay = data.day;
    }

    if (!renderOnly) {
        const targetDay = (lastDay === -1) ? (INITIAL_DAYS - 1) : (lastDay + 1);

        for (let d = lastDay + 1; d <= targetDay; d++) {
            if (d >= MAX_DAYS) break;
            const dayData = generateDayData(d);
            const filename = `${dayData.date}.json`;
            fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(dayData, null, 2));
            console.log(`Generated data for Day ${d} (${filename})`);
        }
    } else {
        console.log('Skipping data generation (--render-only flag detected)');
    }

    const allData = fs.readdirSync(DATA_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .map(f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')));

    const latest = allData.length > 0 ? allData[allData.length - 1] : generateDayData(0);

    // Render Components
    renderTitle();
    renderTree(allData, latest);
    renderMetrics(latest, climateData);
    renderLegend();

})();

// 1. TITLE COMPONENT
function renderTitle() {
    const content = `
    <!-- Transparent Background -->
    <text x="50%" y="35" text-anchor="middle" class="serif text-accent" font-size="32" font-weight="bold" letter-spacing="-0.5">Living Fractal Tree</text>
    <text x="50%" y="60" text-anchor="middle" class="mono text-dim" font-size="14" letter-spacing="1">ENVIRONMENTAL PROGRESS, ONE BRANCH PER DAY</text>
  `;
    writeSVG('title.svg', 800, 80, content);
}

// 2. TREE VISUAL COMPONENT (Rounded Widget)
function renderTree(allData, latest) {
    const w = 800, h = 600;
    let content = `
    <rect width="${w}" height="${h}" rx="12" class="card-bg" />
    <rect x="0" y="0" width="${w}" height="${h}" fill="url(#glow)" rx="12" opacity="0.5"/>
    <ellipse cx="${w / 2}" cy="${h - 10}" rx="200" ry="8" fill="rgba(74,222,128,0.04)" />
    <g>
  `;

    const fullTree = buildTreeStructure();
    const branchesPerDay = Math.max(1, Math.floor(fullTree.length / 365));
    let currentBranchIndex = 0;

    allData.forEach((d) => {
        const endBranch = Math.min(currentBranchIndex + branchesPerDay, fullTree.length);
        const color = scoreToColor(d.score);
        for (let i = currentBranchIndex; i < endBranch; i++) {
            const b = fullTree[i];
            const strokeW = Math.max(1, 7 - b.depth * 0.6);
            const op = b.depth < 3 ? 0.9 : 0.55 + (1 - b.depth / 10) * 0.35;
            const filter = b.depth <= 2 ? 'filter="url(#soft-glow)"' : '';
            content += `<line x1="${b.x1}" y1="${b.y1}" x2="${b.x2}" y2="${b.y2}" stroke="${color}" stroke-width="${strokeW}" opacity="${op}" stroke-linecap="round" ${filter} />`;
        }
        currentBranchIndex = endBranch;
    });
    content += `</g>`;

    // Overlay info
    content += `
    <text x="24" y="34" class="mono text-dim" font-size="12">Day ${latest.day}</text>
    <text x="776" y="34" class="mono text-dim" font-size="12" text-anchor="end">${latest.formattedDate}</text>
  `;

    writeSVG('tree.svg', w, h, content);
}

// 3. METRICS DASHBOARD (Rounded Widget + Composite Score)
// climateData keys: { air, co2, solar, ocean: { sst, wave }, species, vegetation }
function renderMetrics(latest, climateData = {}) {
    const w = 800;
    const cardH = 380;

    // --- Real-data helpers (fall back to simulated values if API returned null) ---
    const realAir        = climateData.air        ?? null;  // AQI number
    const realCO2        = climateData.co2        ?? null;  // ppm
    const realSolar      = climateData.solar      ?? null;  // W/m²
    const realSST        = climateData.ocean?.sst ?? null;  // °C
    const realSpecies    = climateData.species    ?? null;  // total GBIF count
    const realVeg        = climateData.vegetation ?? null;  // mm/day ET₀

    let content = `
    <rect width="${w}" height="${cardH}" rx="12" class="card-bg" />
    <text x="32" y="40" class="serif text-accent" font-size="20" letter-spacing="0.5">Daily Metrics</text>
  `;

    const metrics = [
        {
            label: "🌳 Vegetation Health",
            val:   realVeg   !== null ? `${realVeg} mm/day`     : `${latest.trees.toLocaleString()} trees`,
            pct:   realVeg   !== null ? Math.min(100, realVeg * 20)                                    : latest.treesPct,
            grad: "trees",
            sub:   realVeg   !== null ? "ET₀ · Open-Meteo (rainforest avg)"                           : "simulated · commit-weighted",
        },
        {
            label: "💨 Atmospheric CO₂",
            val:   realCO2   !== null ? `${realCO2} ppm`        : `${latest.co2.toLocaleString()} t`,
            pct:   realCO2   !== null ? Math.min(100, ((realCO2 - 280) / (450 - 280)) * 100)           : latest.co2Pct,
            grad: "co2",
            sub:   realCO2   !== null ? "NOAA Mauna Loa Observatory"                                  : "simulated · commit-weighted",
        },
        {
            label: "⚡ Solar Irradiance",
            val:   realSolar !== null ? `${realSolar} W/m²`     : `${latest.renewable.toLocaleString()} MW`,
            pct:   realSolar !== null ? Math.min(100, (realSolar / 800) * 100)                         : latest.renewPct,
            grad: "renew",
            sub:   realSolar !== null ? "Shortwave · Open-Meteo"                                      : "simulated · commit-weighted",
        },
        {
            label: "🌊 Sea Surface Temp",
            val:   realSST   !== null ? `${realSST}°C`          : `${latest.ocean.toFixed(1)} t`,
            pct:   realSST   !== null ? Math.min(100, Math.max(0, ((realSST - 15) / 15) * 100))        : latest.oceanPct,
            grad: "ocean",
            sub:   realSST   !== null ? "SST · Open-Meteo Marine (equatorial)"                        : "simulated · commit-weighted",
        },
        {
            label: "🏭 Air Quality Index",
            val:   realAir   !== null ? `${realAir} AQI`        : `${latest.air} AQI`,
            pct:   realAir   !== null ? Math.min(100, (realAir / 200) * 100)                           : latest.airPct,
            grad: "air",
            sub:   realAir   !== null ? "US AQI · Open-Meteo (6-city avg)"                            : "simulated · commit-weighted",
        },
        {
            label: "🦎 Species Observed",
            val:   realSpecies !== null ? `${(realSpecies / 1e9).toFixed(2)}B`  : `${latest.wildlife.toFixed(1)}`,
            pct:   realSpecies !== null ? Math.min(100, (realSpecies / 3e9) * 100)                     : latest.wildPct,
            grad: "wild",
            sub:   realSpecies !== null ? "GBIF global occurrence records"                             : "simulated · commit-weighted",
        },
    ];

    const colW = (w - 90) / 2;
    const startY = 80;
    const rowH = 75;

    metrics.forEach((m, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 32 + col * (colW + 26);
        const y = startY + row * rowH;

        content += `<text x="${x}" y="${y}" class="mono text-dim" font-size="10" letter-spacing="1.2" text-transform="uppercase">${m.label}</text>`;
        content += `<text x="${x + colW}" y="${y}" class="mono text-base" font-size="14" font-weight="bold" text-anchor="end">${m.val}</text>`;

        // Bar Track
        content += `<rect x="${x}" y="${y + 12}" width="${colW}" height="6" fill="rgba(255,255,255,0.04)" rx="3" />`;
        // Bar Fill
        const barW = Math.max(0, (m.pct / 100) * colW);
        content += `<rect x="${x}" y="${y + 12}" width="${barW}" height="6" fill="url(#grad-${m.grad})" rx="3" />`;

        content += `<text x="${x}" y="${y + 32}" class="mono text-dim" font-size="9" opacity="0.7">${m.sub}</text>`;
    });

    // --- Composite Score Section ---
    const scoreY = 320;
    const scoreX = 32;
    const scoreW = w - 64; // Full width
    const scoreColor = scoreToColor(latest.score);

    // Box (Full Width)
    content += `<rect x="${scoreX}" y="${scoreY}" width="${scoreW}" height="48" rx="10" fill="rgba(74, 222, 128, 0.04)" stroke="rgba(74, 222, 128, 0.08)" stroke-width="1" />`;

    // Ring (Left Aligned)
    const ringR = 16;
    const ringCX = scoreX + 24;
    const ringCY = scoreY + 24;
    const ringC = 2 * Math.PI * ringR;
    const offset = ringC * (1 - latest.score);

    content += `
    <circle cx="${ringCX}" cy="${ringCY}" r="${ringR}" fill="none" stroke="rgba(74,222,128,0.08)" stroke-width="3" />
    <circle cx="${ringCX}" cy="${ringCY}" r="${ringR}" fill="none" stroke="${scoreColor}" stroke-width="3"
      stroke-dasharray="${ringC}" stroke-dashoffset="${offset}" transform="rotate(-90 ${ringCX} ${ringCY})" stroke-linecap="round" />
  `;

    // Text Stack (Left Aligned)
    const scorePct = Math.round(latest.score * 100);
    const textX = scoreX + 54;

    // Label
    content += `<text x="${textX}" y="${scoreY + 15}" class="mono text-dim" font-size="8" letter-spacing="1.2" text-transform="uppercase">Composite Score</text>`;
    // Value (Percentage)
    content += `<text x="${textX}" y="${scoreY + 30}" class="serif text-accent" font-size="16">${scorePct}%</text>`;
    // Description (Label)
    content += `<text x="${textX}" y="${scoreY + 42}" class="mono text-dim" font-size="9">${latest.scoreLabel}</text>`;

    writeSVG('metrics.svg', w, cardH, content);
}

// 4. LEGEND COMPONENT
function renderLegend() {
    const w = 800, h = 48;
    let content = `
    <rect width="${w}" height="${h}" rx="8" class="card-bg" />
    <g transform="translate(32, 28)">
  `;

    const items = [
        { c: '#22c55e', l: 'Excellent' },
        { c: '#84cc16', l: 'Good' },
        { c: '#eab308', l: 'Moderate' },
        { c: '#f97316', l: 'Below Avg' },
        { c: '#a16207', l: 'Poor' }
    ];

    const itemW = 140;
    items.forEach((item, i) => {
        content += `<g transform="translate(${i * itemW}, 0)">
        <rect width="18" height="4" fill="${item.c}" rx="2" y="-4" />
        <text x="26" y="0" class="mono text-dim" font-size="10">${item.l}</text>
      </g>`;
    });

    content += `</g>`;
    writeSVG('legend.svg', w, h, content);
}

