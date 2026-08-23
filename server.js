// Node 18+ (has native fetch). Run: node server.js
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/session/:pin', async (req, res) => {
    const pin = req.params.pin;
    if (!/^\d{6,10}$/.test(pin)) return res.status(400).json({ error: 'bad pin' });

    try {
        const r = await fetch(`https://kahoot.it/reserve/session/${pin}/?${Date.now()}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            }
        });
        if (r.status !== 200) return res.status(404).json({ active: false });
        const data = await r.json().catch(() => ({}));
        res.json({ active: true, pin, ...data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/', (_, res) => res.send('kahooter proxy up'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`proxy running on http://localhost:${PORT}`));