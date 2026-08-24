const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

const activeSessions = [];

// GET /scan?pin=123456
// Checks if the PIN is valid and active
app.get('/scan', async (req, res) => {
    const { pin } = req.query;

    if (!pin) {
        return res.status(400).json({ valid: false, error: "Query parameter 'pin' is required." });
    }

    try {
        console.log(`[SCAN] Checking status for PIN: ${pin}...`);
        const response = await fetch(`https://kahoot.it/reserve/session/${pin}/?${Date.now()}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                'Referer': 'https://kahoot.it/'
            }
        });

        if (response.status === 200) {
            const data = await response.json();
            return res.json({
                valid: true,
                pin,
                twoFactor: data.twoFactorAuth || false,
                namerator: data.namerator || false,
                raw: data
            });
        } else {
            return res.status(404).json({
                valid: false,
                pin,
                error: "Game PIN not found or game is locked/inactive."
            });
        }
    } catch (err) {
        console.error(`[SCAN ERROR]:`, err.message);
        return res.status(500).json({ valid: false, error: "Failed to connect to Kahoot servers." });
    }
});

// POST /flood
// Body: { "pin": "123456", "name": "Bot", "count": 5 }
app.post('/flood', async (req, res) => {
    try {
        const { pin, name = 'Bot', count = 5 } = req.body;
        
        if (!pin) {
            return res.status(400).json({ error: "Game PIN is required." });
        }

        const botCount = Math.min(Math.max(parseInt(count) || 1, 1), 50);
        const safeBaseName = String(name).slice(0, 8);
        const sessionTag = Math.random().toString(36).substring(2, 5);

        console.log(`\n🚀 Starting flood request: ${botCount} bots for PIN ${pin}...`);

        let joinedCount = 0;
        const promises = [];

        for (let i = 0; i < botCount; i++) {
            const botName = `${safeBaseName}_${i + 1}_${sessionTag}`;
            
            const botTask = (async () => {
                let browser;
                try {
                    browser = await puppeteer.launch({
                        headless: true,
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-accelerated-2d-canvas',
                            '--disable-gpu'
                        ]
                    });

                    const page = await browser.newPage();
                    
                    await page.setRequestInterception(true);
                    page.on('request', (req) => {
                        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
                            req.abort();
                        } else {
                            req.continue();
                        }
                    });

                    await page.goto(`https://kahoot.it/?pin=${pin}`, { waitUntil: 'domcontentloaded', timeout: 20000 });

                    try {
                        const pinInput = await page.$('input[data-functional-selector="game-pin-input"]');
                        if (pinInput) {
                            await page.type('input[data-functional-selector="game-pin-input"]', String(pin));
                            await page.click('button[type="submit"]');
                        }
                    } catch (e) {}

                    const nameSelector = 'input[data-functional-selector="username-input"]';
                    await page.waitForSelector(nameSelector, { timeout: 15000 });
                    await page.type(nameSelector, botName);

                    const joinBtnSelector = 'button[data-functional-selector="join-button-username"]';
                    await page.waitForSelector(joinBtnSelector, { timeout: 10000 });
                    await page.click(joinBtnSelector);

                    joinedCount++;
                    activeSessions.push({ id: botName, browser });
                    console.log(`[JOINED] ${botName} active in lobby!`);
                    return true;
                } catch (err) {
                    console.error(`[FAILED] ${botName}:`, err.message);
                    if (browser) await browser.close();
                    return false;
                }
            })();

            promises.push(botTask);
            await new Promise(r => setTimeout(r, 300));
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
            await session.browser.close();
        } catch (e) {}
    }
    console.log(`🧹 Cleared ${total} bot sessions.`);
    return res.json({ message: `Closed ${total} active bot instances.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
