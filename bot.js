require('dotenv').config();
const { Telegraf } = require('telegraf');
const mysql = require('mysql2/promise');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const bot = new Telegraf(process.env.BOT_TOKEN);
const Web3 = require('web3');

const app = express();
app.use(cors());
app.use(express.json());

// Change from WebSocket to HTTP provider
const web3 = new Web3('https://sepolia.infura.io/v3/bfa7d79d684e465e8cf63b10f095c450');

// Add connection error handling
web3.eth.net.isListening()
    .then(() => console.log('Web3 is connected'))
    .catch(err => console.error('Web3 connection error:', err));

const WEBAPP_URL = 'https://leostar.live:3000';
const ETHERSCAN_API_KEY = 'T721W1PI732GNJB2CUNT8BZUDK31FKU5QD';
const ETHERSCAN_API = 'https://api-sepolia.etherscan.io/api';

const dbConfig = {
    host: "localhost",
    user: "root",
    password: "Admin@123",
    database: "pocket_money"
};

const pool = mysql.createPool(dbConfig);

async function getTransactionsFromEtherscan(address, startBlock = 0) {
    try {
        const response = await axios.get(ETHERSCAN_API, {
            params: {
                module: 'account',
                action: 'txlist',
                address: address,
                startblock: startBlock,
                endblock: '99999999',
                sort: 'asc',
                apikey: ETHERSCAN_API_KEY
            }
        });

        if (response.data.status === '1' && response.data.result.length > 0) {
            return response.data.result.map(tx => ({
                hash: tx.hash,
                blockNumber: parseInt(tx.blockNumber),
                timeStamp: tx.timeStamp,
                from: tx.from,
                to: tx.to,
                value: parseFloat(tx.value) / 1e18,
                isError: tx.isError === '0',
                txreceipt_status: tx.txreceipt_status
            }));
        } else {
            console.log(`No transactions found for address: ${address}`);
            return [];
        }
    } catch (error) {
        console.error('Error fetching transactions from Etherscan:', error);
        return [];
    }
}

async function processUser(telegramUserId, referral_id = null) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Check if user exists
        const [users] = await conn.execute(
            'SELECT * FROM Users WHERE Telegram_User_ID = ?',
            [telegramUserId]
        );

        let userAddress;
        console.log("User =", telegramUserId)
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

            // Create new user with initial balances set to 0
            await conn.execute(
                'INSERT INTO Users (Telegram_User_ID, Deposit_Address_USDT, Deposit_Balance, Stake_Balance, Withdrawal_Balance, Ref_ID) VALUES (?, ?, 0, 0, 0, ?)',
                [telegramUserId, wallet.Wallet_Address, referral_id]
            );

            userAddress = wallet.Wallet_Address;
        } else {
            console.log(users)
            userAddress = users[0].Deposit_Address_USDT;
        }
        console.log(userAddress)
        await conn.commit();

        return userAddress;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function monitorDeposits() {
    const conn = await pool.getConnection();
    try {
        const [users] = await conn.execute('SELECT Telegram_User_ID, Deposit_Address_USDT FROM Users');
        for (const user of users) {
            await processDeposits(user.Telegram_User_ID, user.Deposit_Address_USDT);
        }
    } catch (error) {
        console.error('Error monitoring deposits:', error);
    } finally {
        conn.release();
    }
}

setInterval(monitorDeposits, 120000); // Check deposits every 2 minutes

async function processDeposits(telegramUserId, userAddress) {
    const conn = await pool.getConnection();
    try {
        const [lastTx] = await conn.execute(
            'SELECT Transaction_ID_Blockchain FROM Deposit_Transactions WHERE Telegram_User_ID = ? ORDER BY Deposit_Date DESC LIMIT 1',
            [telegramUserId]
        );
        
        let lastHash = lastTx.length > 0 ? lastTx[0].Transaction_ID_Blockchain : null;
        let startBlock = 0;

        if (lastHash) {
            const [blockInfo] = await conn.execute(
                'SELECT MAX(block_number) as last_block FROM Deposit_Transactions WHERE Telegram_User_ID = ?',
                [telegramUserId]
            );
            startBlock = blockInfo[0].last_block || 0;
        }

        const transactions = await getTransactionsFromEtherscan(userAddress, startBlock);
        if (transactions.length === 0) return;
        
        for (const tx of transactions) {
            if (tx.isError && tx.txreceipt_status === '1') {
                const [existingTx] = await conn.execute(
                    'SELECT 1 FROM Deposit_Transactions WHERE Transaction_ID_Blockchain = ? LIMIT 1',
                    [tx.hash]
                );
                
                if (existingTx.length === 0) {
                    await conn.execute(
                        'INSERT INTO Deposit_Transactions (Telegram_User_ID, Deposit_Date, Transaction_ID_Blockchain, Cr_Amount, Balance, Transaction_Type, block_number) VALUES (?, NOW(), ?, ?, ?, "Deposit", ?)',
                        [telegramUserId, tx.hash, tx.value, tx.value, tx.blockNumber]
                    );
                    console.log(`Deposit recorded: ${tx.hash} for user ${telegramUserId}`);
                } else {
                    console.log(`Transaction ${tx.hash} already exists, skipping.`);
                }
            }
        }
    } catch (error) {
        console.error('Error processing deposits:', error);
    } finally {
        conn.release();
    }
}

// Bot commands
bot.command('start', async (ctx) => {
    try {
        const startPayload = ctx.payload;
        console.log(ctx);
        console.log(ctx.payload)
        if (startPayload) {
            const address = await processUser(ctx.from.id.toString(), startPayload);
            console.log('User came from link with payload:', startPayload);
            ctx.reply('Welcome! Open the menu:', {
                reply_markup: {
                    inline_keyboard: [[
                        { text: 'Open Menu', web_app: { url: `${WEBAPP_URL}?address=${encodeURIComponent(address)}&userId=${ctx.from.id}&ref_id=${startPayload}` } }
                    ]],
                }
            });
        } else {
            const address = await processUser(ctx.from.id.toString());
            console.log('User did not come from link with payload:', startPayload);
            ctx.reply('Welcome! Open the menu:', {
                reply_markup: {
                    inline_keyboard: [[
                        { text: 'Open Menu', web_app: { url: `${WEBAPP_URL}?address=${encodeURIComponent(address)}&userId=${ctx.from.id}` } }
                    ]],
                }
            });
        }
    } catch (error) {
        console.error('Error processing user:', error);
        ctx.reply('Sorry, there was an error. Please try again later.');
    }
});

// Start express server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Express server running on port ${PORT}`);
});

bot.launch();

// Handle graceful shutdown
process.once('SIGINT', () => {
    if (global.monitoringIntervals) {
        for (const interval of global.monitoringIntervals.values()) {
            clearInterval(interval);
        }
    }
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    if (global.monitoringIntervals) {
        for (const interval of global.monitoringIntervals.values()) {
            clearInterval(interval);
        }
    }
    bot.stop('SIGTERM');
});