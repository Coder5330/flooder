const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function pad(n) { return String(n).padStart(7, '0'); }

async function checkPin(pin) {
    try {
        const r = await fetch(`https://kahoot.it/reserve/session/${pin}/?${Date.now()}`, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
        });
        if (r.status !== 200) return null;
        const data = await r.json().catch(() => ({}));
        return { pin, ...data };
    } catch { 
        return null; 
    }
}

// Optimized SSE Scanner Endpoint
app.get('/scan', async (req, res) => {
    const start = parseInt(req.query.start) || 0;
    const end = parseInt(req.query.end) || 1000000;
    const conc = Math.min(parseInt(req.query.conc) || 150, 300);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    let currentPin = start;
    let checked = 0;
    let hits = 0;
    let alive = true;
    const total = end - start;

    req.on('close', () => { alive = false; });

    async function worker() {
        while (alive) {
            let n;
            // Lock access to the pin counter
            if (currentPin >= end) break;
            n = currentPin++;

            const pin = pad(n);
            const result = await checkPin(pin);
            
            if (!alive) break;
            
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

    const workers = Array.from({ length: conc }, () => worker());
    await Promise.all(workers);

    if (alive) {
        res.write(`event: done\ndata: ${JSON.stringify({ checked, hits })}\n\n`);
        res.end();
    }
});

// Single PIN Verification Endpoint
app.get('/session/:pin', async (req, res) => {
    const pin = req.params.pin;
    if (!/^\d{6,10}$/.test(pin)) return res.status(400).json({ error: 'Invalid PIN' });
    const result = await checkPin(pin);
    result ? res.json({ active: true, ...result }) : res.status(404).json({ active: false });
});

// Bot Flooding logic
function spawnBot(pin, name, botIndex) {
    return new Promise((resolve) => {
        const botName = `${name}_${botIndex + 1}`;
        const ws = new WebSocket(`wss://kahoot.it/cometd/${pin}/${Date.now()}`);

        let clientAckId = 1;
        let clientId = null;

        const timeout = setTimeout(() => {
            ws.terminate();
            resolve({ botName, status: 'timeout' });
        }, 10000);

        ws.on('open', () => {
            // Handshake 1: CometD Connect handshake
            const handshake = [{
                id: String(clientAckId++),
                version: '1.0',
                minimumVersion: '1.0',
                channel: '/meta/handshake',
                supportedConnectionTypes: ['websocket'],
                advice: { timeout: 60000, interval: 0 }
            }];
            ws.send(JSON.stringify(handshake));
        });

        ws.on('message', (data) => {
            try {
                const messages = JSON.parse(data.toString());
                for (const msg of messages) {
                    // Handshake response -> Register Client ID
                    if (msg.channel === '/meta/handshake' && msg.successful) {
                        clientId = msg.clientId;
                        
                        // Handshake 2: Connect channel
                        ws.send(JSON.stringify([{
                            id: String(clientAckId++),
                            channel: '/meta/connect',
                            connectionType: 'websocket',
                            clientId: clientId,
                            advice: { timeout: 0 }
                        }]));

                        // Handshake 3: Send Login payload
                        ws.send(JSON.stringify([{
                            id: String(clientAckId++),
                            channel: '/service/controller',
                            clientId: clientId,
                            data: {
                                type: 'login',
                                gameid: pin,
                                host: 'kahoot.it',
                                name: botName
                            }
                        }]));
                    }

                    // Login response
                    if (msg.channel === '/service/controller' && msg.data) {
                        clearTimeout(timeout);
                        if (msg.data.type === 'loginResponse') {
                            resolve({ botName, status: 'joined', clientId });
                        } else {
                            ws.close();
                            resolve({ botName, status: 'rejected', reason: msg.data });
                        }
                    }
                }
            } catch {
                // Ignore malformed frames
            }
        });

        ws.on('error', () => {
            clearTimeout(timeout);
            resolve({ botName, status: 'failed' });
        });
    });
}

// Bot Flood Endpoint
app.post('/flood', async (req, res) => {
    const { pin, name = 'Bot', count = 10 } = req.body;

    if (!pin || !/^\d{6,10}$/.test(String(pin))) {
        return res.status(400).json({ error: 'Valid game PIN is required' });
    }

    const botCount = Math.min(Math.max(parseInt(count) || 1, 1), 100); // capped at 100 max per request
    const session = await checkPin(pin);

    if (!session) {
        return res.status(404).json({ error: 'Game session not found or inactive' });
    }

    // Spawn bots concurrently in batches to avoid network throttling
    const BATCH_SIZE = 10;
    const results = [];

    for (let i = 0; i < botCount; i += BATCH_SIZE) {
        const batch = [];
        for (let j = i; j < Math.min(i + BATCH_SIZE, botCount); j++) {
            batch.push(spawnBot(pin, name, j));
        }
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
    }

    const successful = results.filter(r => r.status === 'joined').length;
    res.json({
        pin,
        requested: botCount,
        joined: successful,
        details: results
    });
});

app.get('*', (_, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
