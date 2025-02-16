require('dotenv').config();
const { Telegraf } = require('telegraf');
const mysql = require('mysql2/promise');
const bot = new Telegraf(process.env.BOT_TOKEN);

// Replace with your deployed webapp URL
const WEBAPP_URL = 'https://brief-presently-ladybug.ngrok-free.app';

// Database connection configuration
const dbConfig = {
    host: "localhost",
    user: "root",
    password: "123456",
    database: "pocket_money"
};

const pool = mysql.createPool(dbConfig, auth_plugin='mysql_native_password');

async function getUserAddress(telegramUserId) {
    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.execute(
            'SELECT Deposit_Address_USDT FROM Users WHERE Telegram_User_ID = ?',
            [telegramUserId]
        );
        return rows.length > 0 ? rows[0].Deposit_Address_USDT : null;
    } finally {
        conn.release();
    }
}

// Function to check if user exists and assign wallet if needed
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
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

bot.command('start', (ctx) => {
    ctx.reply('Welcome! Open the menu:', {
        reply_markup: {
            inline_keyboard: [[
                { text: 'Open Menu', web_app: { url: WEBAPP_URL } }
            ]]
        }
    });
});

bot.on('web_app_data', async (ctx) => {
    try {
        console.log('Raw Web App Data:', ctx.webAppData); // Debugging log
        if (!ctx.webAppData || !ctx.webAppData.data) {
            throw new Error('No data received from WebApp');
        }

        let data;
        if (typeof ctx.webAppData.data.json === 'function') {
            data = await ctx.webAppData.data.json();  // If it's a Response object, parse it as JSON
        } else if (typeof ctx.webAppData.data.text === 'function') {
            const textData = await ctx.webAppData.data.text();  // If it's a text response, parse it
            data = JSON.parse(textData);
        } else if (typeof ctx.webAppData.data === 'string') {
            data = JSON.parse(ctx.webAppData.data); // Normal string JSON case
        } else {
            data = ctx.webAppData.data; // If it's already an object
        }

        console.log('Parsed Data:', data); // Log parsed data for debugging

        if (!data.option) {
            throw new Error('Missing "option" in received data');
        }

        if (data.option === "1" || data.option === 1) {
            try {
                const address = await getUserAddress(ctx.from.id.toString());
                if (address) {
                    // Send both a text message with the address and a button to view it in the web app
                    await ctx.reply(`Your deposit address: ${address}`);
                    await ctx.reply('Click below to view address with QR code:', {
                        reply_markup: {
                            inline_keyboard: [[
                                { 
                                    text: 'View Address & QR Code', 
                                    web_app: { 
                                        url: `${WEBAPP_URL}?address=${encodeURIComponent(address)}`
                                    } 
                                }
                            ]]
                        }
                    });
                } else {
                    ctx.reply('Error: Address not found. Please try again later.');
                }
            } catch (dbError) {
                console.error('Database error:', dbError);
                ctx.reply('Sorry, there was an error retrieving your address');
            }
        } else {
            ctx.reply(`You selected Option ${data.option} in the WebApp`);
        }
    } catch (error) {
        console.error('Bot error:', error);
        ctx.reply('An error occurred. Please try again.');
    }
});

// Error handling middleware
bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('An error occurred while processing your request.');
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// // Create database connection pool
// const pool = mysql.createPool(dbConfig, auth_plugin='mysql_native_password');

// async function getUserAddress(telegramUserId) {
//     const conn = await pool.getConnection();
//     try {
//         const [rows] = await conn.execute(
//             'SELECT Deposit_Address_USDT FROM Users WHERE Telegram_User_ID = ?',
//             [telegramUserId]
//         );
//         return rows.length > 0 ? rows[0].Deposit_Address_USDT : null;
//     } finally {
//         conn.release();
//     }
// }

// // Function to check if user exists and assign wallet if needed
// async function processUser(telegramUserId) {
//     const conn = await pool.getConnection();
//     try {
//         await conn.beginTransaction();

//         // Check if user exists
//         const [users] = await conn.execute(
//             'SELECT * FROM Users WHERE Telegram_User_ID = ?',
//             [telegramUserId]
//         );

//         if (users.length === 0) {
//             // Get first unused wallet address
//             const [wallets] = await conn.execute(
//                 'SELECT Wallet_ID, Wallet_Address FROM Wallet_Addresses WHERE Used_Flag = ? LIMIT 1',
//                 ['Unused']
//             );

//             if (wallets.length === 0) {
//                 throw new Error('No unused wallet addresses available');
//             }

//             const wallet = wallets[0];

//             // Mark wallet as used
//             await conn.execute(
//                 'UPDATE Wallet_Addresses SET Used_Flag = ?, Used_By = ? WHERE Wallet_ID = ?',
//                 ['Used', telegramUserId, wallet.Wallet_ID]
//             );

//             // Create new user
//             await conn.execute(
//                 'INSERT INTO Users (Telegram_User_ID, Deposit_Address_USDT) VALUES (?, ?)',
//                 [telegramUserId, wallet.Wallet_Address]
//             );
//         }

//         await conn.commit();
//     } catch (error) {
//         await conn.rollback();
//         throw error;
//     } finally {
//         conn.release();
//     }
// }

// // Start command handler
// bot.command('start', (ctx) => {
//     ctx.reply('Welcome! Open the menu:', {
//         reply_markup: {
//             inline_keyboard: [[
//                 { text: 'Open Menu', web_app: { url: WEBAPP_URL } }
//             ]]
//         }
//     });
// });

// // Web app data handler
// bot.on('web_app_data', async (ctx) => {
//     try {
//         console.log('Raw Web App Data:', ctx.webAppData); // Debugging log

//         if (!ctx.webAppData || !ctx.webAppData.data) {
//             throw new Error('No data received from WebApp');
//         }

//         let data;
//         if (typeof ctx.webAppData.data.json === 'function') {
//             data = await ctx.webAppData.data.json();  // If it's a Response object, parse it as JSON
//         } else if (typeof ctx.webAppData.data.text === 'function') {
//             const textData = await ctx.webAppData.data.text();  // If it's a text response, parse it
//             data = JSON.parse(textData);
//         } else if (typeof ctx.webAppData.data === 'string') {
//             data = JSON.parse(ctx.webAppData.data); // Normal string JSON case
//         } else {
//             data = ctx.webAppData.data; // If it's already an object
//         }

//         console.log('Parsed Data:', data); // Log parsed data for debugging

//         if (!data.option) {
//             throw new Error('Missing "option" in received data');
//         }

//         if (data.option === "1" || data.option === 1) {
//             try {
//                 const address = await getUserAddress(ctx.from.id.toString());
//                 if (address) {
//                     ctx.reply('View your deposit address:', {
//                         reply_markup: {
//                             inline_keyboard: [[
//                                 { 
//                                     text: 'View Address & QR Code', 
//                                     web_app: { 
//                                         url: `${WEBAPP_URL}/address.html?address=${encodeURIComponent(address)}` 
//                                     } 
//                                 }
//                             ]]
//                         }
//                     });
//                 } else {
//                     ctx.reply('Error: Address not found. Please try again later.');
//                 }
//             } catch (dbError) {
//                 console.error('Database error:', dbError);
//                 ctx.reply('Sorry, there was an error retrieving your address');
//             }
//         } else {
//             ctx.reply(`You selected Option ${data.option} in the WebApp`);
//         }
//     } catch (error) {
//         console.error('Bot error:', error);
//         ctx.reply(`An error occurred: ${error.message}`);
//     }
// });

// // Error handling middleware
// bot.catch((err, ctx) => {
//     console.error('Bot error:', err);
//     ctx.reply('An error occurred while processing your request.');
// });

// bot.launch();

// // Enable graceful stop
// process.once('SIGINT', () => bot.stop('SIGINT'));
// process.once('SIGTERM', () => bot.stop('SIGTERM'));