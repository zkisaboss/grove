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
    console.log('Starting backfill process (30 days)...');
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

    // Calculate bounding box once
    let clipRegion = null;
    const treePanel = await page.$('.tree-panel');
    const statBars = await page.$('.stat-bars');
    if (treePanel && statBars) {
        const treeBox = await treePanel.boundingBox();
        const statBox = await statBars.boundingBox();
        const x = Math.min(treeBox.x, statBox.x);
        const y = Math.min(treeBox.y, statBox.y);
        const width = Math.max(treeBox.x + treeBox.width, statBox.x + statBox.width) - x;
        const height = (statBox.y + statBox.height) - y;
        clipRegion = { x, y, width, height };
    } else {
        console.error('Could not find elements');
        await browser.close();
        return;
    }

    // --- Automation Sequence ---

    // 1. Reset everything
    await page.evaluate(() => {
        // Access the reset function if exposed? 
        // It's attached to btn-reset
        document.getElementById('btn-reset').click();
    });

    // Wait for reset and commit re-animation (estimate)
    // 100 commits * 15ms = 1.5s. Let's wait 3s to be safe.
    await new Promise(r => setTimeout(r, 3000));

    // 2. Loop through 30 days
    const START_DATE = new Date();
    START_DATE.setDate(START_DATE.getDate() - 30);

    for (let i = 0; i <= 30; i++) {
        const currentDate = new Date(START_DATE);
        currentDate.setDate(currentDate.getDate() + i);
        const dateStr = currentDate.toISOString().split('T')[0];

        // Take snapshot
        const snapshotPath = path.join(SNAPSHOT_DIR, `day-${dateStr}.png`);
        await page.screenshot({ path: snapshotPath, clip: clipRegion });
        console.log(`Saved snapshot for Day ${i}: ${snapshotPath}`);

        // Advance Day
        if (i < 30) {
            await page.evaluate(() => {
                document.getElementById('btn-next').click();
            });
            // Wait for CSS transition (0.4s)
            await new Promise(r => setTimeout(r, 600));
        }
    }

    await browser.close();

    // Compile GIF
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
    encoder.setRepeat(0);
    encoder.setDelay(200);  // Faster animation for history (200ms)
    encoder.setQuality(10);

    for (const file of files) {
        const filePath = path.join(SNAPSHOT_DIR, file);
        const pngData = fs.readFileSync(filePath);
        const png = PNG.sync.read(pngData);

        if (png.width === width && png.height === height) {
            encoder.addFrame(png.data);
        }
    }

    encoder.finish();
    console.log(`GIF updated at ${OUTPUT_GIF}`);
}
