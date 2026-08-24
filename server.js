const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const activeSessions = [];
let sharedBrowser = null;

// Helper to get or launch a single shared browser instance
async function getBrowser() {
    if (sharedBrowser && sharedBrowser.connected) {
        return sharedBrowser;
    }
    sharedBrowser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--no-first-run',
            '--safebrowsing-disable-auto-update'
        ]
    });
    return sharedBrowser;
}

// GET /scan?pin=123456
app.get('/scan', async (req, res) => {
    const { pin } = req.query;
    if (!pin) return res.status(400).json({ valid: false, error: "Query parameter 'pin' is required." });

    try {
        const response = await fetch(`https://kahoot.it/reserve/session/${pin}/?${Date.now()}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                'Referer': 'https://kahoot.it/'
            }
        });

        if (response.status === 200) {
            const data = await response.json();
            return res.json({ valid: true, pin, raw: data });
        } else {
            return res.status(404).json({ valid: false, pin, error: "Game PIN invalid or locked." });
        }
    } catch (err) {
        return res.status(500).json({ valid: false, error: "Failed to connect to Kahoot." });
    }
});

// POST /flood
app.post('/flood', async (req, res) => {
    try {
        const { pin, name = 'Bot', count = 5 } = req.body;
        if (!pin) return res.status(400).json({ error: "Game PIN is required." });

        const botCount = Math.min(Math.max(parseInt(count) || 1, 1), 50);
        const safeBaseName = String(name).slice(0, 8);
        const sessionTag = Math.random().toString(36).substring(2, 5);

        console.log(`\n🚀 Fast-flooding ${botCount} bots for PIN ${pin}...`);
        const mainBrowser = await getBrowser();

        let joinedCount = 0;
        const promises = [];

        for (let i = 0; i < botCount; i++) {
            const botName = `${safeBaseName}_${i + 1}_${sessionTag}`;
            
            const botTask = (async () => {
                let context;
                try {
                    // Create an isolated incognito tab session instead of a full browser
                    context = await mainBrowser.createBrowserContext();
                    const page = await context.newPage();

                    // Block everything not strictly needed for execution
                    await page.setRequestInterception(true);
                    page.on('request', (req) => {
                        const type = req.resourceType();
                        if (['image', 'stylesheet', 'font', 'media', 'other'].includes(type)) {
                            req.abort();
                        } else {
                            req.continue();
                        }
                    });

                    await page.goto(`https://kahoot.it/?pin=${pin}`, { waitUntil: 'domcontentloaded', timeout: 15000 });

                    // Handle PIN input if present
                    try {
                        const pinInput = await page.$('input[data-functional-selector="game-pin-input"]');
                        if (pinInput) {
                            await page.type('input[data-functional-selector="game-pin-input"]', String(pin));
                            await page.click('button[type="submit"]');
                        }
                    } catch (e) {}

                    // Enter Bot Nickname
                    const nameSelector = 'input[data-functional-selector="username-input"]';
                    await page.waitForSelector(nameSelector, { timeout: 10000 });
                    await page.type(nameSelector, botName);

                    // Click Join
                    const joinBtnSelector = 'button[data-functional-selector="join-button-username"]';
                    await page.waitForSelector(joinBtnSelector, { timeout: 8000 });
                    await page.click(joinBtnSelector);

                    joinedCount++;
                    activeSessions.push({ id: botName, context });
                    console.log(`[JOINED] ${botName}`);
                    return true;
                } catch (err) {
                    console.error(`[FAILED] ${botName}:`, err.message);
                    if (context) await context.close();
                    return false;
                }
            })();

            promises.push(botTask);
            // Reduced delay to 75ms for faster entry without completely locking the CPU
            await new Promise(r => setTimeout(r, 75));
        }

        await Promise.all(promises);

        return res.json({
            status: "success",
            pin,
            requested: botCount,
            joined: joinedCount
        });

    } catch (err) {
        console.error("Server Flood Error:", err);
        return res.status(500).json({ error: err.message || "Failed to process request" });
    }
});

// POST /clear
app.post('/clear', async (req, res) => {
    const total = activeSessions.length;
    while (activeSessions.length > 0) {
        const session = activeSessions.pop();
        try {
            await session.context.close();
        } catch (e) {}
    }
    
    if (sharedBrowser) {
        try {
            await sharedBrowser.close();
            sharedBrowser = null;
        } catch (e) {}
    }

    console.log(`🧹 Cleared ${total} bot sessions and reset browser.`);
    return res.json({ message: `Closed ${total} active bot instances.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ High-Performance Server running on port ${PORT}`);
});
