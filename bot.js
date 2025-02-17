require('dotenv').config();
const { Telegraf } = require('telegraf');
const mysql = require('mysql2/promise');
const express = require('express');
const cors = require('cors');
const bot = new Telegraf(process.env.BOT_TOKEN);
const Web3 = require('web3');

const app = express();
app.use(cors());
app.use(express.json());

const web3 = new Web3(new Web3.providers.WebsocketProvider('wss://sepolia.infura.io/ws/v3/bfa7d79d684e465e8cf63b10f095c450'));
// Add connection error handling
web3.eth.net.isListening()
    .then(() => console.log('Web3 is connected'))
    .catch(err => console.error('Web3 connection error:', err));
const USDT_CONTRACT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'; // BSC USDT
const USDT_ABI = [
    {
        "constant": true,
        "inputs": [
            {"name": "_owner","type": "address"}
        ],
        "name": "balanceOf",
        "outputs": [{"name": "balance","type": "uint256"}],
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true,"name": "from","type": "address"},
            {"indexed": true,"name": "to","type": "address"},
            {"indexed": false,"name": "value","type": "uint256"}
        ],
        "name": "Transfer",
        "type": "event"
    }
];

const usdtContract = new web3.eth.Contract(USDT_ABI, USDT_CONTRACT_ADDRESS);

const WEBAPP_URL = 'https://leostar.live:3000';

const dbConfig = {
    host: "localhost",
    user: "root",
    password: "Admin@123",
    database: "pocket_money"
};

const pool = mysql.createPool(dbConfig, auth_plugin='mysql_native_password');

// Add new function to check transactions
async function checkNewTransactions(userAddress, telegramUserId) {
    try {
        const conn = await pool.getConnection();
        
        // Get the latest transaction we've processed
        const [lastTx] = await conn.execute(
            'SELECT Transaction_ID_Blockchain FROM Deposit_Transactions WHERE Telegram_User_ID = ? ORDER BY TrID DESC LIMIT 1',
            [telegramUserId]
        );
        
        // Get transactions from blockchain
        const latestBlock = await web3.eth.getBlockNumber();
        const fromBlock = lastTx.length > 0 ? 
            (await web3.eth.getTransaction(lastTx[0].Transaction_ID_Blockchain)).blockNumber : 
            latestBlock - 5000; // Look back ~24 hours if no previous transactions
        
        const events = await usdtContract.getPastEvents('Transfer', {
            fromBlock: fromBlock,
            toBlock: 'latest',
            filter: { to: userAddress }
        });

        for (const event of events) {
            // Check if transaction already exists
            const [existingTx] = await conn.execute(
                'SELECT * FROM Deposit_Transactions WHERE Transaction_ID_Blockchain = ?',
                [event.transactionHash]
            );

            if (existingTx.length === 0) {
                const amount = web3.utils.fromWei(event.returnValues.value, 'ether');
                
                await conn.beginTransaction();
                try {
                    // Add transaction record
                    await conn.execute(
                        'INSERT INTO Deposit_Transactions (Telegram_User_ID, Deposit_Date, Transaction_ID_Blockchain, Amount, Balance, Transation_Type) VALUES (?, NOW(), ?, ?, (SELECT Deposit_Balance + ? FROM Users WHERE Telegram_User_ID = ?), "Deposit")',
                        [telegramUserId, event.transactionHash, amount, amount, telegramUserId]
                    );

                    // Update user balance
                    await conn.execute(
                        'UPDATE Users SET Deposit_Balance = Deposit_Balance + ? WHERE Telegram_User_ID = ?',
                        [amount, telegramUserId]
                    );

                    await conn.commit();
                } catch (error) {
                    await conn.rollback();
                    throw error;
                }
            }
        }
        
        conn.release();
        return true;
    } catch (error) {
        console.error('Error checking transactions:', error);
        return false;
    }
}

async function processUser(telegramUserId) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Check if user exists
        const [users] = await conn.execute(
            'SELECT * FROM Users WHERE Telegram_User_ID = ?',
            [telegramUserId]
        );

        let userAddress;

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
                'INSERT INTO Users (Telegram_User_ID, Deposit_Address_USDT, Deposit_Balance, Stake_Balance, Withdraw_Balance) VALUES (?, ?, 0, 0, 0)',
                [telegramUserId, wallet.Wallet_Address]
            );

            userAddress = wallet.Wallet_Address;
        } else {
            userAddress = users[0].Deposit_Address_USDT;
        }

        await conn.commit();

        // Start transaction monitoring for this user
        async function monitorTransactions() {
            try {
                // Get the latest transaction we've processed
                const [lastTx] = await conn.execute(
                    'SELECT Transaction_ID_Blockchain FROM Deposit_Transactions WHERE Telegram_User_ID = ? ORDER BY TrID DESC LIMIT 1',
                    [telegramUserId]
                );
                
                // Get transactions from blockchain
                const latestBlock = await web3.eth.getBlockNumber();
                const fromBlock = lastTx.length > 0 ? 
                    (await web3.eth.getTransaction(lastTx[0].Transaction_ID_Blockchain)).blockNumber : 
                    latestBlock - 5000; // Look back ~24 hours if no previous transactions
                
                const events = await usdtContract.getPastEvents('Transfer', {
                    fromBlock: fromBlock,
                    toBlock: 'latest',
                    filter: { to: userAddress }
                });

                for (const event of events) {
                    // Check if transaction already exists
                    const [existingTx] = await conn.execute(
                        'SELECT * FROM Deposit_Transactions WHERE Transaction_ID_Blockchain = ?',
                        [event.transactionHash]
                    );

                    if (existingTx.length === 0) {
                        const amount = web3.utils.fromWei(event.returnValues.value, 'ether');
                        
                        await conn.beginTransaction();
                        try {
                            // Get current balance for the user
                            const [currentBalance] = await conn.execute(
                                'SELECT Deposit_Balance FROM Users WHERE Telegram_User_ID = ?',
                                [telegramUserId]
                            );
                            
                            const newBalance = parseFloat(currentBalance[0].Deposit_Balance) + parseFloat(amount);

                            // Add transaction record
                            await conn.execute(
                                'INSERT INTO Deposit_Transactions (Telegram_User_ID, Deposit_Date, Transaction_ID_Blockchain, Amount, Balance, Transation_Type) VALUES (?, NOW(), ?, ?, ?, "Deposit")',
                                [telegramUserId, event.transactionHash, amount, newBalance]
                            );

                            // Update user balance
                            await conn.execute(
                                'UPDATE Users SET Deposit_Balance = ? WHERE Telegram_User_ID = ?',
                                [newBalance, telegramUserId]
                            );

                            await conn.commit();
                            console.log(`Processed new transaction for user ${telegramUserId}: ${amount} USDT`);
                        } catch (error) {
                            await conn.rollback();
                            console.error('Error processing transaction:', error);
                        }
                    }
                }
            } catch (error) {
                console.error('Error in transaction monitoring:', error);
            }
        }

        // Start monitoring with error handling
        const monitoringInterval = setInterval(async () => {
            try {
                await monitorTransactions();
            } catch (error) {
                console.error('Error in monitoring interval:', error);
                // Don't stop the interval on error, just log it and continue
            }
        }, 10000); // Check every 10 seconds

        // Store the interval reference in a map to be able to clear it later if needed
        if (!global.monitoringIntervals) {
            global.monitoringIntervals = new Map();
        }
        // Clear any existing interval for this user
        if (global.monitoringIntervals.has(telegramUserId)) {
            clearInterval(global.monitoringIntervals.get(telegramUserId));
        }
        global.monitoringIntervals.set(telegramUserId, monitoringInterval);

        return userAddress;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

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