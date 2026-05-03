const puppeteer = require('puppeteer');
const GifEncoder = require('gif-encoder-2');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const OUTPUT_GIF = path.join(__dirname, '../assets/growth.gif');
const SNAPSHOT_DIR = path.join(__dirname, '../data/snapshots');

if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

(async () => {
    console.log('Starting full-cycle snapshot process (Static Metrics, Animated Tree)...');
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // High quality viewport
    await page.setViewport({ width: 960, height: 1080, deviceScaleFactor: 2 });

    const filePath = 'file://' + path.join(__dirname, '../index.html');
    await page.goto(filePath, { waitUntil: 'networkidle0' });

    // Wait for init
    try {
        await page.waitForSelector('.ready', { timeout: 15000 });
    } catch (e) {
        console.log('Timeout waiting for .ready class, proceeding...');
    }
    await new Promise(r => setTimeout(r, 1000));

    // Hide controls/grain
    await page.addStyleTag({
        content: `
      .inline-controls { display: none !important; } 
      .grain { opacity: 0; }
    `
    });

    // Calculate bounding box for Tree Panel ONLY
    let clipRegion = null;
    const treePanel = await page.$('.tree-panel');

    if (treePanel) {
        const treeBox = await treePanel.boundingBox();
        clipRegion = {
            x: treeBox.x,
            y: treeBox.y,
            width: treeBox.width,
            height: treeBox.height
        };
    } else {
        console.error('Could not find tree-panel');
        await browser.close();
        return;
    }

    // --- Step 1: Reach "Full Growth" (Day 30) ---
    // This ensures the METRICS are at Day 30 levels (Static for the GIF)
    // The tree will also be at Day 30.

    // First, verify current day. If < 30, advance.
    const currentDay = await page.evaluate(() => {
        return parseInt(document.getElementById('day-display').textContent) || 0;
    });

    const TARGET_DAY = 30;
    if (currentDay < TARGET_DAY) {
        console.log(`Advancing from Day ${currentDay} to ${TARGET_DAY}...`);
        for (let i = currentDay; i < TARGET_DAY; i++) {
            await page.evaluate(() => document.getElementById('btn-next').click());
            // Small delay purely for stability, though we only care about final state
            if (i % 5 === 0) await new Promise(r => setTimeout(r, 100));
        }
    }
    // Wait for final transitions
    await new Promise(r => setTimeout(r, 1000));

    // --- Step 2: Animate Tree via Visibility Toggling ---
    // We now have specific metrics (Day 30). We will keep them on screen.
    // We will loop from Frame 0 to Frame 30, and for each frame,
    // we will ONLY show tree branches that belong to that day or earlier.

    console.log('Generating frames...');

    // Clean snapshots
    fs.readdirSync(SNAPSHOT_DIR).forEach(f => {
        if (f.endsWith('.png')) fs.unlinkSync(path.join(SNAPSHOT_DIR, f));
    });

    for (let frame = 0; frame <= TARGET_DAY; frame++) {
        await page.evaluate((f) => {
            const lines = document.querySelectorAll('#tree-group line');
            lines.forEach(line => {
                // Env branches have dataset.day
                if (line.dataset.type === 'env') {
                    const d = parseInt(line.dataset.day);
                    // Hide if branch day is in the future relative to this frame
                    line.style.display = (d <= f) ? 'block' : 'none';
                } else {
                    // Commit branches (no day). Show them if we are past day 5 (init period)
                    // or just show them always to avoid floating? 
                    // Let's show them starting frame 5 to allow 'growth' feel
                    line.style.display = (f >= 5) ? 'block' : 'none';
                }
            });
        }, frame);

        const snapshotPath = path.join(SNAPSHOT_DIR, `frame-${String(frame).padStart(3, '0')}.png`);
        await page.screenshot({ path: snapshotPath, clip: clipRegion });
    }

    await browser.close();
    await createGifFromSnapshots();
})();

async function createGifFromSnapshots() {
    const files = fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.png')).sort();
    if (files.length === 0) return;

    console.log(`Compiling GIF from ${files.length} snapshots...`);

    // Read first file to get dimensions
    const firstPng = PNG.sync.read(fs.readFileSync(path.join(SNAPSHOT_DIR, files[0])));
    const width = firstPng.width;
    const height = firstPng.height;

    // Setup encoder
    const encoder = new GifEncoder(width, height);
    const fileStream = fs.createWriteStream(OUTPUT_GIF);

    encoder.createReadStream().pipe(fileStream);
    encoder.start();
    encoder.setRepeat(0);   // 0 for repeat, -1 for no-repeat
    encoder.setDelay(500);  // frame delay in ms
    encoder.setQuality(10); // image quality. 10 is default.

    for (const file of files) {
        const filePath = path.join(SNAPSHOT_DIR, file);
        const pngData = fs.readFileSync(filePath);
        const png = PNG.sync.read(pngData);

        // Check if dimensions match
        if (png.width !== width || png.height !== height) {
            console.warn(`Skipping ${file}: Dimension mismatch (${png.width}x${png.height} vs ${width}x${height})`);
            continue;
        }

        // gif-encoder-2 uses RGBA input directly
        encoder.addFrame(png.data);
    }

    encoder.finish();
    console.log(`GIF updated at ${OUTPUT_GIF}`);
}
