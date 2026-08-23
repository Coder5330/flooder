const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Serve all static frontend files from your 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

function pad(n) { return String(n).padStart(7, '0'); }

async function checkPin(pin) {
    try {
        const r = await fetch(`https://kahoot.it{pin}/?${Date.now()}`, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        if (r.status !== 200) return null;
        const data = await r.json().catch(() => ({}));
        return { pin, ...data };
    } catch { return null; }
}

app.get('/scan', async (req, res) => {
    const start = parseInt(req.query.start) || 0;
    const end = parseInt(req.query.end) || 1000000;
    const conc = Math.min(parseInt(req.query.conc) || 150, 300);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    let cursor = start;
    let checked = 0;
    let hits = 0;
    let alive = true;
    const total = end - start;

    req.on('close', () => { alive = false; });

    async function worker() {
        while (alive && cursor < end) {
            const n = cursor++;
            const pin = pad(n);
            const result = await checkPin(pin);
            checked++;

            if (result) {
                hits++;
                res.write(`event: hit\ndata: ${JSON.stringify(result)}\n\n`);
            }

            if (checked % 50 === 0) {
                res.write(`event: progress\ndata: ${JSON.stringify({ checked, total, hits })}\n\n`);
            }
        }
    }

    const workers = [];
    for (let i = 0; i < conc; i++) workers.push(worker());
    await Promise.all(workers);

    res.write(`event: done\ndata: ${JSON.stringify({ checked, hits })}\n\n`);
    res.end();
});

app.get('/session/:pin', async (req, res) => {
    const pin = req.params.pin;
    if (!/^\d{6,10}$/.test(pin)) return res.status(400).json({ error: 'bad pin' });
    const result = await checkPin(pin);
    result ? res.json({ active: true, ...result }) : res.status(404).json({ active: false });
});

// Fallback: Send index.html for any other route requests
app.get('*', (_, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
