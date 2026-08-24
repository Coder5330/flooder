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
    console.log(`[1] Fetching session token & challenge for PIN: ${PIN}...`);
    
    const res = await fetch(`https://kahoot.it/reserve/session/${PIN}/?${Date.now()}`);
    if (res.status !== 200) {
        console.error("❌ Invalid PIN or game not active.");
        return;
    }

    const headerToken = res.headers.get('x-kahoot-session-token');
    const data = await res.json();
    
    const challengeMask = solveChallenge(data.challenge);
    const solvedToken = decodeSessionToken(headerToken, challengeMask);
    
    console.log(`✔ Decoded Session Token: ${solvedToken}`);
    console.log(`\n[2] Connecting to WebSocket with token...`);

    const ws = new WebSocket(`wss://kahoot.it/cometd/${PIN}/${solvedToken}`);
    let clientId = null;
    let ack = 1;
    let connectInterval = null;

    const sendPacket = (msg) => {
        msg.id = String(ack++);
        if (clientId) msg.clientId = clientId;
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
        console.log("✔ WebSocket Connected! Initiating /meta/handshake...");
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
            // Handshake Response
            if (msg.channel === '/meta/handshake' && msg.successful) {
                clientId = msg.clientId;
                console.log(`✔ Handshake accepted! Client ID: ${clientId}`);
                
                // 1. Send initial connect
                sendPacket({
                    channel: '/meta/connect',
                    connectionType: 'websocket'
                });

                // 2. Subscribe to required channels
                sendPacket({
                    channel: '/meta/subscribe',
                    subscription: '/service/controller'
                });
                
                sendPacket({
                    channel: '/meta/subscribe',
                    subscription: '/service/player'
                });

                sendPacket({
                    channel: '/meta/subscribe',
                    subscription: '/service/status'
                });

                // 3. Register Player Login payload inside data.content
                console.log(`[3] Submitting login payload for name (${BOT_NAME})...`);
                sendPacket({
                    channel: '/service/controller',
                    data: {
                        type: 'login',
                        gameid: PIN,
                        host: 'kahoot.it',
                        name: BOT_NAME,
                        content: JSON.stringify({
                            device: { userAgent: 'Mozilla/5.0', screen: { width: 1920, height: 1080 } }
                        })
                    }
                });
            } 
            
            // First /meta/connect ack -> start continuous heartbeat
            else if (msg.channel === '/meta/connect' && msg.successful) {
                startHeartbeat();
            }

            // Login response output handling
            else if (msg.channel === '/service/controller' && msg.data?.type === 'loginResponse') {
                if (!msg.data.error) {
                    console.log(`\n🎉 SUCCESS! ${BOT_NAME} registered and active in lobby!`);
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
