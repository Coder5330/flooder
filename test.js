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

    // Helper to send CometD messages
    const sendMessage = (msg) => {
        msg.id = String(ack++);
        msg.clientId = clientId;
        ws.send(JSON.stringify([msg]));
    };

    // Keep-alive loop required by Kahoot CometD engine
    const startHeartbeat = () => {
        if (connectInterval) return;
        connectInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                sendMessage({
                    channel: '/meta/connect',
                    connectionType: 'websocket'
                });
            }
        }, 5000);
    };

    ws.on('open', () => {
        console.log("✔ WebSocket Connected! Sending /meta/handshake...");
        ws.send(JSON.stringify([{
            id: String(ack++),
            version: '1.0',
            minimumVersion: '1.0',
            channel: '/meta/handshake',
            supportedConnectionTypes: ['websocket']
        }]));
    });

    ws.on('message', (msgData) => {
        const raw = msgData.toString();
        const msgs = JSON.parse(raw);

        for (const msg of msgs) {
            // Handshake Response
            if (msg.channel === '/meta/handshake' && msg.successful) {
                clientId = msg.clientId;
                console.log(`✔ Handshake accepted! Client ID: ${clientId}`);
                
                // 1. Initial /meta/connect
                sendMessage({
                    channel: '/meta/connect',
                    connectionType: 'websocket'
                });

                // 2. Register Player Login
                console.log(`[3] Registering Bot Name (${BOT_NAME})...`);
                sendMessage({
                    channel: '/service/controller',
                    data: {
                        type: 'login',
                        gameid: PIN,
                        host: 'kahoot.it',
                        name: BOT_NAME
                    }
                });
            } 
            
            // First /meta/connect acknowledgement -> Start recurring heartbeat
            else if (msg.channel === '/meta/connect' && msg.successful) {
                startHeartbeat();
            }

            // Login Confirmation Response
            else if (msg.channel === '/service/controller' && msg.data?.type === 'loginResponse') {
                if (!msg.data.error) {
                    console.log(`\n🎉 SUCCESS! ${BOT_NAME} should now show on the screen!`);
                } else {
                    console.error(`❌ Host Rejected Bot:`, msg.data);
                }
            }
        }
    });

    ws.on('close', () => clearInterval(connectInterval));
    ws.on('error', (err) => console.error("❌ WS Error:", err.message));
}

runDiagnostic();
