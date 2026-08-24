const puppeteer = require('puppeteer');

(async () => {
    const PIN = '433273'; // Your active PIN
    const BOT_NAME = `Bot_${Math.floor(Math.random() * 899 + 100)}`;

    console.log(`[1] Launching headless browser for bot: ${BOT_NAME}...`);
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    console.log(`[2] Navigating to Kahoot...`);
    await page.goto(`https://kahoot.it/?pin=${PIN}`, { waitUntil: 'networkidle2' });

    console.log(`[3] Entering Game PIN...`);
    // Handles both auto-filled PIN URL and manual input
    const pinInput = await page.$('#game-input');
    if (pinInput) {
        await page.type('#game-input', PIN);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
    }

    console.log(`[4] Entering Bot Name (${BOT_NAME})...`);
    await page.waitForSelector('#nickname', { timeout: 10000 });
    await page.type('#nickname', BOT_NAME);
    await page.click('button[type="submit"]');

    console.log(`🎉 SUCCESS! ${BOT_NAME} submitted via headless browser. Check your lobby!`);

    // Keep browser alive to maintain the connection
    await new Promise(() => {});
})();
