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

// Change from WebSocket to HTTP provider
const web3 = new Web3('https://sepolia.infura.io/v3/bfa7d79d684e465e8cf63b10f095c450');

// Add connection error handling
web3.eth.net.isListening()
    .then(() => console.log('Web3 is connected'))
    .catch(err => console.error('Web3 connection error:', err));

const WEBAPP_URL = 'https://leostar.live:3000';

const dbConfig = {
    host: "localhost",
    user: "root",
    password: "Admin@123",
    database: "pocket_money"
};

const pool = mysql.createPool(dbConfig);

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

        // Set up polling for transactions instead of WebSocket subscription
        startTransactionPolling(telegramUserId, userAddress);

        return userAddress;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

// Poll for new transactions at regular intervals
function startTransactionPolling(telegramUserId, userAddress) {
    if (!global.pollingIntervals) {
        global.pollingIntervals = new Map();
    }

    // Clear any existing interval for this user
    if (global.pollingIntervals.has(telegramUserId)) {
        clearInterval(global.pollingIntervals.get(telegramUserId));
    }

    let lastProcessedBlock = 0;
    
    const pollInterval = setInterval(async () => {
        try {
            const conn = await pool.getConnection();
            
            try {
                // Get the last processed block for this user
                const [lastTx] = await conn.execute(
                    'SELECT MAX(Cr_amount) as last_block FROM Deposit_Transactions WHERE Telegram_User_ID = ?',
                    [telegramUserId]
                );
                
                if (lastTx[0].last_block) {
                    lastProcessedBlock = lastTx[0].last_block;
                } else {
                    // If no transactions yet, start from current block - 100
                    const currentBlock = await web3.eth.getBlockNumber();
                    lastProcessedBlock = currentBlock - 100;
                }
                
                // Get latest block number
                const latestBlock = await web3.eth.getBlockNumber();
                
                // Process blocks in batches to avoid overloading
                const batchSize = 10;
                const startBlock = lastProcessedBlock + 1;
                const endBlock = Math.min(latestBlock, startBlock + batchSize - 1);
                
                console.log(`Checking blocks ${startBlock} to ${endBlock} for address ${userAddress}`);
                
                // Process each block
                for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
                    const block = await web3.eth.getBlock(blockNumber, true);
                    
                    if (block && block.transactions) {
                        for (const tx of block.transactions) {
                            if (tx.to && tx.to.toLowerCase() === userAddress.toLowerCase()) {
                                await processDeposit(conn, telegramUserId, tx, blockNumber);
                            }
                        }
                    }
                    
                    // Update last processed block
                    lastProcessedBlock = blockNumber;
                }
            } catch (error) {
                console.error('Error during transaction polling:', error);
            } finally {
                conn.release();
            }
        } catch (error) {
            console.error('Connection error during polling:', error);
        }
    }, 30000); // Check every 30 seconds
    
    global.pollingIntervals.set(telegramUserId, pollInterval);
}

async function processDeposit(conn, telegramUserId, tx, blockNumber) {
    const txHash = tx.hash;
    const amount = web3.utils.fromWei(tx.value, 'ether');
    
    console.log(`Processing Deposit: ${txHash} - Amount: ${amount} ETH for user ${telegramUserId}`);
    
    // Check if transaction already exists
    const [existingTx] = await conn.execute(
        'SELECT * FROM Deposit_Transactions WHERE Transaction_ID_Blockchain = ?',
        [txHash]
    );
    
    if (existingTx.length > 0) {
        console.log(`Transaction ${txHash} already processed, skipping`);
        return;
    }
    
    await conn.beginTransaction();
    try {
        // Get user's current balance
        const [currentBalance] = await conn.execute(
            'SELECT Deposit_Balance FROM Users WHERE Telegram_User_ID = ?',
            [telegramUserId]
        );
        
        const newBalance = parseFloat(currentBalance[0].Deposit_Balance) + parseFloat(amount);
        
        // Insert new deposit transaction
        await conn.execute(
            'INSERT INTO Deposit_Transactions (Telegram_User_ID, Deposit_Date, Transaction_ID_Blockchain, Cr_Amount, Balance, Transation_Type, block_number) VALUES (?, NOW(), ?, ?, ?, "Deposit", ?)',
            [telegramUserId, txHash, amount, newBalance, blockNumber]
        );
        
        // Update user balance
        await conn.execute(
            'UPDATE Users SET Deposit_Balance = ? WHERE Telegram_User_ID = ?',
            [newBalance, telegramUserId]
        );
        
        await conn.commit();
        console.log(`Transaction recorded: ${txHash}`);
        
        // Send notification to the user
        try {
            await bot.telegram.sendMessage(telegramUserId, 
                `🎉 Deposit Received!\n\n` +
                `Amount: ${amount} ETH\n` +
                `Transaction: ${txHash}\n\n` +
                `Your new balance is ${newBalance} USDT`
            );
        } catch (notifyError) {
            console.error('Failed to send notification:', notifyError);
        }
    } catch (error) {
        await conn.rollback();
        console.error('Transaction processing failed:', error);
    }
}

// Rest of your code...

bot.command('start', async (ctx) => {
    try {
        const startPayload = ctx.payload;
        console.log(ctx);
        console.log(ctx.payload)
        if (startPayload) {
            const address = await processUser(ctx.from.id.toString(), startPayload);
            console.log('User came from link with payload:', startPayload);
            // You can add more logic to process the payload if needed
            ctx.reply('Welcome! Open the menu:', {
            reply_markup: {
                inline_keyboard: [[
                    { text: 'Open Menu', web_app: { url: `${WEBAPP_URL}?address=${encodeURIComponent(address)}&userId=${ctx.from.id}&ref_id=${startPayload}` } }
                ]],
            }
        });
        }
        else {
            const address = await processUser(ctx.from.id.toString());
            console.log('User did not came from link with payload:', startPayload);
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
    // Clear all intervals
    if (global.pollingIntervals) {
        for (const interval of global.pollingIntervals.values()) {
            clearInterval(interval);
        }
    }
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    // Clear all intervals
    if (global.pollingIntervals) {
        for (const interval of global.pollingIntervals.values()) {
            clearInterval(interval);
        }
    }
    bot.stop('SIGTERM');
});