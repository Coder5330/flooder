const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const Kahoot = require('kahoot.js-updated');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Reuse persistent HTTP agent to eliminate TCP/TLS handshake overhead
const agent = new https.Agent({ keepAlive: true, maxSockets: 1000 });

function pad(n) { return String(n).padStart(7, '0'); }

async function checkPinFast(pin) {
    try {
        const r = await fetch(`https://kahoot.it/reserve/session/${pin}/?${Date.now()}`, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            agent
        });
        if (r.status !== 200) return null;
        const data = await r.json().catch(() => ({}));
        return { pin, ...data };
    } catch { 
        return null; 
    }
}

// ULTRA-FAST SSE SCANNER
app.get('/scan', async (req, res) => {
    const start = parseInt(req.query.start) || 0;
    const end = parseInt(req.query.end) || 1000000;
    // Bumping batch size for high-throughput parallel execution
    const batchSize = Math.min(parseInt(req.query.conc) || 500, 1000);

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    let current = start;
    let checked = 0;
    let hits = 0;
    let alive = true;
    const total = end - start;

    req.on('close', () => { alive = false; });

    while (alive && current < end) {
        const batch = [];
        const limit = Math.min(current + batchSize, end);

        for (let i = current; i < limit; i++) {
            const pin = pad(i);
            batch.push(
                checkPinFast(pin).then(result => {
                    checked++;
                    if (result) {
                        hits++;
                        res.write(`event: hit\ndata: ${JSON.stringify(result)}\n\n`);
                    }
                })
            );
        }

        current = limit;
        // Process entire chunk simultaneously in network micro-batches
        await Promise.all(batch);

        if (checked % 100 === 0 || current >= end) {
            res.write(`event: progress\ndata: ${JSON.stringify({ checked, total, hits })}\n\n`);
        }
    }

    if (alive) {
        res.write(`event: done\ndata: ${JSON.stringify({ checked, hits })}\n\n`);
        res.end();
    }
});

// INSTANT FIRE-AND-FORGET BOT FLOODER
function spawnBotFireAndForget(pin, name, botIndex) {
    return new Promise((resolve) => {
        const botName = `${name}_${botIndex + 1}`;
        const ws = new WebSocket(`wss://kahoot.it/cometd/${pin}/${Date.now()}`);

        let ack = 1;
        const timeout = setTimeout(() => {
            ws.terminate();
            resolve({ botName, status: 'timeout' });
        }, 4000); // Aggressive timeout

        ws.on('open', () => {
            ws.send(JSON.stringify([{
                id: String(ack++),
                version: '1.0',
                minimumVersion: '1.0',
                channel: '/meta/handshake',
                supportedConnectionTypes: ['websocket']
            }]));
        });

        ws.on('message', (data) => {
            try {
                const [msg] = JSON.parse(data.toString());
                if (msg.channel === '/meta/handshake' && msg.successful) {
                    // Send connect & login instantly in a single pipeline burst
                    ws.send(JSON.stringify([
                        {
                            id: String(ack++),
                            channel: '/meta/connect',
                            connectionType: 'websocket',
                            clientId: msg.clientId
                        },
                        {
                            id: String(ack++),
                            channel: '/service/controller',
                            clientId: msg.clientId,
                            data: { type: 'login', gameid: pin, host: 'kahoot.it', name: botName }
                        }
                    ]));
                } else if (msg.channel === '/service/controller') {
                    clearTimeout(timeout);
                    resolve({ botName, status: 'joined' });
                }
            } catch {
                // Ignore parse errors
            }
        });

        ws.on('error', () => {
            clearTimeout(timeout);
            resolve({ botName, status: 'failed' });
        });
    });
}

// Bot flooder using automated session solving
app.post('/flood', async (req, res) => {
    const { pin, name = 'Bot', count = 20 } = req.body;
    const botCount = Math.min(Math.max(parseInt(count) || 1, 1), 100);

    let joinedCount = 0;
    const bots = [];

    const spawnBot = (index) => {
        return new Promise((resolve) => {
            const client = new Kahoot();
            const botName = `${name}_${index + 1}`;

            // Set timeout if connection stalls
            const timer = setTimeout(() => {
                try { client.leave(); } catch {}
                resolve(false);
            }, 6000);

            client.join(pin, botName).then(() => {
                clearTimeout(timer);
                joinedCount++;
                resolve(true);
            }).catch(() => {
                clearTimeout(timer);
                resolve(false);
            });

            bots.push(client);
        });
    };

    // Stagger joins slightly (30ms) to avoid instant IP rate-limiting
    const promises = [];
    for (let i = 0; i < botCount; i++) {
        promises.push(spawnBot(i));
        await new Promise(r => setTimeout(r, 30));
    }

    await Promise.all(promises);

    res.json({ pin, requested: botCount, joined: joinedCount });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Fast Server active on port ${PORT}`));
