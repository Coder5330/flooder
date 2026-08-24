const WebSocket = require('ws');
const vm = require('vm');

const PIN = '433273'; // Replace with active PIN
const BOT_NAME = `Test_${Math.floor(Math.random() * 899 + 100)}`;

function solveChallenge(challengeStr) {
    const cleanStr = challengeStr.replace(/[\u2000-\u200B\u202F\u205F\u200C\u200D]/g, '');
    const sandbox = {
        angular: { isDate: () => false, isNumber: () => false, isString: () => false, isArray: () => false, isObject: () => false },
        _: { replace: (str, regex, fn) => str.replace(regex, fn) },
        console: { log: () => {} }
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;

    const context = vm.createContext(sandbox);
    return vm.runInContext(cleanStr, context);
}

function decodeSessionToken(headerToken, challengeMask) {
    const rawHeader = Buffer.from(headerToken, 'base64').toString('utf-8');
    let result = '';
    for (let i = 0; i < rawHeader.length; i++) {
        result += String.fromCharCode(rawHeader.charCodeAt(i) ^ challengeMask.charCodeAt(i % challengeMask.length));
    }
    return result;
}

async function runDiagnostic() {
    console.log(`[1] Fetching session token & cookies for PIN: ${PIN}...`);
    
    const res = await fetch(`https://kahoot.it/reserve/session/${PIN}/?${Date.now()}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://kahoot.it/'
        }
    });

    if (res.status !== 200) {
        console.error("❌ Invalid PIN or game not active.");
        return;
    }

    // Capture Cloudflare & Kahoot cookies from the HTTP response
    const setCookieHeader = res.headers.get('set-cookie');
    const cookieString = setCookieHeader ? setCookieHeader.split(',').map(c => c.split(';')[0]).join('; ') : '';

    const headerToken = res.headers.get('x-kahoot-session-token');
    const data = await res.json();
    
    const challengeMask = solveChallenge(data.challenge);
    const solvedToken = decodeSessionToken(headerToken, challengeMask);
    
    console.log(`✔ Decoded Session Token: ${solvedToken}`);
    console.log(`\n[2] Connecting to WebSocket with captured cookies...`);

    // Pass the cookies in the WebSocket header so Cloudflare authenticates the stream
    const ws = new WebSocket(`wss://kahoot.it/cometd/${PIN}/${solvedToken}`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Origin': 'https://kahoot.it',
            'Referer': `https://kahoot.it/?pin=${PIN}`,
            'Cookie': cookieString,
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    let clientId = null;
    let ack = 1;
    let serverAck = 0;
    let connectInterval = null;

    const sendPacket = (msg) => {
        msg.id = String(ack++);
        if (clientId) msg.clientId = clientId;
        msg.ext = {
            ack: serverAck,
            timesync: { tc: Date.now(), l: 0, o: 0 }
        };
        ws.send(JSON.stringify([msg]));
    };

    const startHeartbeat = () => {
        if (connectInterval) return;
        connectInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                sendPacket({
                    channel: '/meta/connect',
                    connectionType: 'websocket'
                });
            }
        }, 5000);
    };

    ws.on('open', () => {
        console.log("✔ WebSocket Connected with Cookies! Sending handshake...");
        sendPacket({
            version: '1.0',
            minimumVersion: '1.0',
            channel: '/meta/handshake',
            supportedConnectionTypes: ['websocket']
        });
    });

    ws.on('message', (msgData) => {
        const raw = msgData.toString();
        const msgs = JSON.parse(raw);

        for (const msg of msgs) {
            if (msg.ext?.ack !== undefined) {
                serverAck = msg.ext.ack;
            }

            if (msg.channel === '/meta/handshake' && msg.successful) {
                clientId = msg.clientId;
                console.log(`✔ Handshake accepted! Client ID: ${clientId}`);
                
                sendPacket({
                    channel: '/meta/connect',
                    connectionType: 'websocket'
                });

                sendPacket({ channel: '/meta/subscribe', subscription: '/service/controller' });
                sendPacket({ channel: '/meta/subscribe', subscription: '/service/player' });
                sendPacket({ channel: '/meta/subscribe', subscription: '/service/status' });

                console.log(`[3] Registering Bot Name (${BOT_NAME})...`);
                sendPacket({
                    channel: '/service/controller',
                    data: {
                        type: 'login',
                        gameid: PIN,
                        host: 'kahoot.it',
                        name: BOT_NAME,
                        content: JSON.stringify({
                            device: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', screen: { width: 1920, height: 1080 } }
                        })
                    }
                });
            } 
            
            else if (msg.channel === '/meta/connect' && msg.successful) {
                startHeartbeat();
            }

            else if (msg.channel === '/service/controller' && msg.data?.type === 'loginResponse') {
                if (!msg.data.error) {
                    console.log(`\n🎉 SUCCESS! ${BOT_NAME} is fully authenticated and visible in the lobby!`);
                } else {
                    console.error(`❌ Host Rejected Bot:`, msg.data.error);
                }
            }
        }
    });

    ws.on('close', () => clearInterval(connectInterval));
    ws.on('error', (err) => console.error("❌ WS Error:", err.message));
}

runDiagnostic();
