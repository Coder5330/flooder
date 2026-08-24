const WebSocket = require('ws');

const PIN = '433273'; // Replace with your active game PIN
const BOT_NAME = `Test_${Math.floor(Math.random() * 8999 + 1000)}`;

async function runDiagnostic() {
    console.log(`[1] Fetching reserve session token for PIN: ${PIN}...`);
    
    // Step 1: Session Token Exchange
    let response;
    try {
        response = await fetch(`https://kahoot.it/reserve/session/${PIN}/?${Date.now()}`);
    } catch (err) {
        console.error("❌ Failed to contact Kahoot session reserve:", err.message);
        return;
    }

    console.log(`[HTTP Status]: ${response.status}`);
    const rawHeaderToken = response.headers.get('x-kahoot-session-token');
    console.log(`[Session Header Token]:`, rawHeaderToken || "NONE (PIN may be invalid/closed)");

    if (response.status !== 200) {
        console.error("❌ Game PIN is invalid, expired, or locked.");
        return;
    }

    // Step 2: Open WebSocket Connection
    console.log(`\n[2] Connecting to Kahoot WebSocket engine...`);
    const ws = new WebSocket(`wss://kahoot.it/cometd/${PIN}/${Date.now()}`);
    let clientId = null;
    let ack = 1;

    ws.on('open', () => {
        console.log("✔ WebSocket TCP connected. Sending Handshake...");
        ws.send(JSON.stringify([{
            id: String(ack++),
            version: '1.0',
            minimumVersion: '1.0',
            channel: '/meta/handshake',
            supportedConnectionTypes: ['websocket']
        }]));
    });

    ws.on('message', (data) => {
        const raw = data.toString();
        console.log(`\n[SERVER INCOMING]:`, raw);

        try {
            const [msg] = JSON.parse(raw);

            // Handshake Acknowledgement
            if (msg.channel === '/meta/handshake') {
                if (msg.successful) {
                    clientId = msg.clientId;
                    console.log(`✔ Handshake successful! Client ID: ${clientId}`);
                    console.log(`[3] Sending Connection & Login Bursts...`);

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
                } else {
                    console.error("❌ Handshake rejected by server:", msg);
                }
            } 
            // Controller Response
            else if (msg.channel === '/service/controller') {
                if (msg.data && msg.data.type === 'loginResponse') {
                    console.log(`\n--- LOGIN RESPONSE RESULT ---`);
                    console.log(msg.data);
                }
            }
        } catch (e) {
            console.error("Failed to parse incoming frame:", e);
        }
    });

    ws.on('error', (err) => console.error("❌ WS Error:", err.message));
    ws.on('close', (code, reason) => console.log(`ℹ WS Closed with code ${code}. Reason: ${reason}`));
}

runDiagnostic();
