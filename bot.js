
require('dotenv').config();
const { Telegraf } = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN);

// Replace with your deployed webapp URL
const WEBAPP_URL = 'https://05ec-2406-b400-72-ae1b-ec22-d51f-793d-3607.ngrok-free.app';

bot.command('start', (ctx) => {
    ctx.reply('Welcome! Open the menu:', {
        reply_markup: {
            inline_keyboard: [[
                { text: 'Open Menu', web_app: { url: WEBAPP_URL } }
            ]]
        }
    });
});

bot.on('web_app_data', (ctx) => {
    const data = JSON.parse(ctx.webAppData.data);
    ctx.reply(`You selected Option ${data.option} in the WebApp`);
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));