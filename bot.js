require('dotenv').config();
const { Telegraf } = require('telegraf');
const mysql = require('mysql2/promise');
const bot = new Telegraf(process.env.BOT_TOKEN);

const WEBAPP_URL = 'https://brief-presently-ladybug.ngrok-free.app';

const dbConfig = {
    host: "localhost",
    user: "root",
    password: "123456",
    database: "pocket_money"
};

const pool = mysql.createPool(dbConfig, auth_plugin='mysql_native_password');

async function processUser(telegramUserId) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Check if user exists
        const [users] = await conn.execute(
            'SELECT * FROM Users WHERE Telegram_User_ID = ?',
            [telegramUserId]
        );

        if (users.length === 0) {
            // Get first unused wallet address
            const [wallets] = await conn.execute(
                'SELECT Wallet_ID, Wallet_Address FROM Wallet_Addresses WHERE Used_Flag = ? LIMIT 1',
                ['Unused']
            );

            if (wallets.length === 0) {
                throw new Error('No unused wallet addresses available');
            }

            const wallet = wallets[0];

            // Mark wallet as used
            await conn.execute(
                'UPDATE Wallet_Addresses SET Used_Flag = ?, Used_By = ? WHERE Wallet_ID = ?',
                ['Used', telegramUserId, wallet.Wallet_ID]
            );

            // Create new user
            await conn.execute(
                'INSERT INTO Users (Telegram_User_ID, Deposit_Address_USDT) VALUES (?, ?)',
                [telegramUserId, wallet.Wallet_Address]
            );
        }

        await conn.commit();
        
        // Return the user's address
        const [rows] = await conn.execute(
            'SELECT Deposit_Address_USDT FROM Users WHERE Telegram_User_ID = ?',
            [telegramUserId]
        );
        return rows[0].Deposit_Address_USDT;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

bot.command('start', async (ctx) => {
    try {
        // Process user and get their address
        const address = await processUser(ctx.from.id.toString());
        
        // Send the initial menu with the address as a URL parameter
        ctx.reply('Welcome! Open the menu:', {
            reply_markup: {
                inline_keyboard: [[
                    { text: 'Open Menu', web_app: { url: `${WEBAPP_URL}?address=${encodeURIComponent(address)}` } }
                ]]
            }
        });
    } catch (error) {
        console.error('Error processing user:', error);
        ctx.reply('Sorry, there was an error. Please try again later.');
    }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));