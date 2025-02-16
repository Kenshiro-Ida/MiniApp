require('dotenv').config();
const { Telegraf } = require('telegraf');
const mysql = require('mysql2/promise');
const express = require('express');
const cors = require('cors');
const bot = new Telegraf(process.env.BOT_TOKEN);

const app = express();
app.use(cors());
app.use(express.json());

const WEBAPP_URL = 'https://leostar.live:3000/';

const dbConfig = {
    host: "localhost",
    user: "root",
    password: "Admin@123",
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

// New endpoint to fetch user balances
app.get('/api/balances/:userId', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.execute(
            'SELECT Deposit_Balance, Stake_Balance, Withdraw_Balance FROM Users WHERE Telegram_User_ID = ?',
            [req.params.userId]
        );
        
        if (rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        
        res.json({
            deposit_balance: rows[0].Deposit_Balance,
            stake_balance: rows[0].Stake_Balance,
            withdraw_balance: rows[0].Withdraw_Balance
        });
    } catch (error) {
        console.error('Error fetching balances:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        conn.release();
    }
});

bot.command('start', async (ctx) => {
    try {
        const address = await processUser(ctx.from.id.toString());
        ctx.reply('Welcome! Open the menu:', {
            reply_markup: {
                inline_keyboard: [[
                    { text: 'Open Menu', web_app: { url: `${WEBAPP_URL}?address=${encodeURIComponent(address)}&userId=${ctx.from.id}` } }
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