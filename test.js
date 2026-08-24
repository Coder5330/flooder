const WebSocket = require('ws');
const vm = require('vm');

const PIN = '433273'; // Replace with active PIN
const BOT_NAME = `Test_${Math.floor(Math.random() * 899 + 100)}`;

function solveChallenge(challengeStr) {
    // Clean invisible/non-breaking unicode spaces from Kahoot's obfuscation
    const cleanStr = challengeStr.replace(/[\u2000-\u200B\u202F\u205F\u200C\u200D]/g, '');

    // Setup an isolated sandbox environment where 'this' and 'angular' are valid
    const sandbox = {
        angular: {
            isDate: () => false,
            isNumber: () => false,
            isString: () => false,
            isArray: () => false,
            isObject: () => false,
        },
        _: {
            replace: (str, regex, fn) => str.replace(regex, fn)
        },
        console: { log: () => {} }
    };

    // Attach properties to global inside the context
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
        console.log(`\n[SERVER INCOMING]:`, raw);

        const [msg] = JSON.parse(raw);

        if (msg.channel === '/meta/handshake' && msg.successful) {
            clientId = msg.clientId;
            console.log(`✔ Handshake accepted! Client ID: ${clientId}`);
            console.log(`[3] Registering Bot Name (${BOT_NAME})...`);

            ws.send(JSON.stringify([
                {
                    id: String(ack++),
                    channel: '/meta/connect',
                    connectionType: 'websocket',
                    clientId: clientId
                },
                {
                    id: String(ack++),
                    channel: '/service/controller',
                    clientId: clientId,
                    data: {
                        type: 'login',
                        gameid: PIN,
                        host: 'kahoot.it',
                        name: BOT_NAME
                    }
                }
            ]));
        } else if (msg.channel === '/service/controller' && msg.data?.type === 'loginResponse') {
            if (!msg.data.error) {
                console.log(`\n🎉 SUCCESS! ${BOT_NAME} is officially rendered in the Kahoot lobby!`);
            } else {
                console.error(`❌ Host Rejected Bot:`, msg.data);
            }
        }
    });

    ws.on('error', (err) => console.error("❌ WS Error:", err.message));
}

runDiagnostic();
