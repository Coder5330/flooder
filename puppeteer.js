const puppeteer = require('puppeteer');

(async () => {
    const PIN = '433273'; // Replace with active PIN
    const BOT_NAME = `Bot_${Math.floor(Math.random() * 899 + 100)}`;

    console.log(`[1] Launching headless browser for bot: ${BOT_NAME}...`);
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();

    console.log(`[2] Navigating to Kahoot...`);
    await page.goto(`https://kahoot.it/?pin=${PIN}`, { waitUntil: 'networkidle2' });

    // Step 1: PIN Input (if not auto-submitted via query string)
    try {
        const pinInput = await page.$('input[data-functional-selector="game-pin-input"]');
        if (pinInput) {
            console.log(`[3] Entering PIN: ${PIN}...`);
            await page.type('input[data-functional-selector="game-pin-input"]', PIN);
            await page.click('button[type="submit"]');
        }
    } catch (e) {
        // PIN was already accepted via URL parameter
    }

    // Step 2: Name Input
    console.log(`[4] Waiting for nickname field...`);
    const nameSelector = 'input[data-functional-selector="username-input"]';
    await page.waitForSelector(nameSelector, { timeout: 15000 });

    console.log(`[5] Typing name (${BOT_NAME}) and joining...`);
    await page.type(nameSelector, BOT_NAME);
    
    // Click join button
    const joinBtnSelector = 'button[data-functional-selector="join-button-username"]';
    await page.waitForSelector(joinBtnSelector);
    await page.click(joinBtnSelector);

    console.log(`\n🎉 SUCCESS! ${BOT_NAME} has joined the lobby! Check your Kahoot host screen!`);

    // Keep browser alive to keep bot active in lobby
    await new Promise(() => {});
})();
