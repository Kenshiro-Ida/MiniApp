from flask import Flask, jsonify
import mysql.connector
from flask_cors import CORS

app = Flask(__name__)
CORS(app, supports_credentials=True, origins=["https://leostar.live:3000"])

# Database connection settings
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "Admin@123",
    "database": "pocket_money",
    "port": 3306
}

# Function to get database connection
def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG, auth_plugin='mysql_native_password')

@app.route('/get_users', methods=['GET'])
def get_users():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM Users")
    total_users = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM Users WHERE Stake_Balance > 0")
    active_users = cursor.fetchone()[0]
    cursor.execute("SELECT SUM(Cr_Amount) FROM Deposit_Transactions")
    total_deposit = cursor.fetchone()[0] or 0
    cursor.execute("SELECT SUM(Stake_Balance) FROM Users")
    total_staking = cursor.fetchone()[0] or 0
    cursor.execute("SELECT SUM(Dr_Amount) FROM Deposit_Transactions WHERE Transaction_Type='Withdrawal'")
    total_withdrawals_done = cursor.fetchone()[0] or 0
    cursor.execute("SELECT SUM(Withdrawal_Balance) FROM Users")
    total_withdrawals_available = cursor.fetchone()[0] or 0
    cursor.close()
    conn.close()
    return jsonify({"total_users": total_users, "active_users": active_users,"total_deposit": total_deposit, "total_staking": total_staking, "total_withdrawals_done": total_withdrawals_done, "total_withdrawals_available": total_withdrawals_available})

@app.route('/get_deposit_detail', methods=['GET'])
def get_deposit_detail():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT Deposit_Date, Telegram_User_ID, Balance, Cr_Amount, Transaction_ID_Blockchain FROM Deposit_Transactions ORDER BY TrID ASC")
    deposits = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify([{"Date": d[0], "Telegram_User_ID": d[1], "Address": d[2], "Amount": d[3], "Transaction_Hash": d[4]} for d in deposits])

@app.route('/get_staking_detail', methods=['GET'])
def get_staking_detail():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT Deposit_Date, Telegram_User_ID, Balance, Dr_Amount FROM Deposit_Transactions WHERE Transaction_Type='Stake'")
    staking_details = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify([{"Date": d[0], "Telegram_User_ID": d[1], "Address": d[2], "Amount": d[3]} for d in staking_details])

@app.route('/get_withdrawals_details', methods=['GET'])
def get_withdrawals_details():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT Deposit_Date, Telegram_User_ID, Dr_Amount FROM Deposit_Transactions WHERE Transaction_Type='Withdrawal'")
    withdrawals = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify([{"Date": w[0], "Telegram_User_ID": w[1], "Amount": w[2]} for w in withdrawals])

@app.route('/get_withdrawal_balance', methods=['GET'])
def get_withdrawal_balance():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT Telegram_User_ID, Withdrawal_Balance FROM Users WHERE Withdrawal_Balance > 0")
    balances = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify([{"Telegram_User_ID": b[0], "Withdrawal_Balance": b[1]} for b in balances])

@app.route('/get_payout', methods=['GET'])
def get_payout():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT Telegram_User_ID, Deposit_Date, Cr_Amount, Transaction_Type FROM Deposit_Transactions WHERE Transaction_Type IN ('Referral Bonus', 'Staking Reward')")
    payouts = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify([{"Telegram_User_ID": p[0],"Date": p[1],"Cr_Amount":p[2], "Transaction_Type": p[3]} for p in payouts])

if __name__ == "__main__":
    app.run(ssl_context=("leostar.live.crt", "private.key"), host="0.0.0.0", debug=True, port=5002)
