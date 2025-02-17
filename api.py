from flask import Flask, request, jsonify
import mysql.connector
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app, supports_credentials=True, origins=["https://leostar.live:3000"])
BOT_TOKEN = "7866394885:AAERteHAoQXEWArGfj-jo1bgQSp5k7Xbre4"  # Replace with your actual Telegram bot token

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

@app.route("/get_balance", methods=["GET"])
def get_balance():
    telegram_user_id = request.args.get("telegram_user_id")

    if not telegram_user_id:
        return jsonify({"error": "Missing telegram_user_id"}), 400

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)

        query = "SELECT Deposit_Balance, Stake_Balance FROM Users WHERE Telegram_User_ID = %s"
        cursor.execute(query, (telegram_user_id,))
        user_data = cursor.fetchone()

        cursor.close()
        conn.close()

        if user_data:
            # Convert balances to float to ensure they are numbers
            deposit_balance = float(user_data["Deposit_Balance"]) if user_data["Deposit_Balance"] is not None else 0.0
            stake_balance = float(user_data["Stake_Balance"]) if user_data["Stake_Balance"] is not None else 0.0

            return jsonify({
                "telegram_user_id": telegram_user_id,
                "Deposit_Balance": deposit_balance,
                "Stake_Balance": stake_balance
            })
        else:
            return jsonify({"error": "User not found"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/stake', methods=['POST'])
def stake():
    data = request.get_json()
    user_id = data.get('userId')
    amount = data.get('amount')
    
    conn = None
    cursor = None
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        
        # Start transaction
        conn.start_transaction()
        
        # Check if user has sufficient balance
        cursor.execute(
            'SELECT Deposit_Balance FROM Users WHERE Telegram_User_ID = %s', (user_id,)
        )
        user = cursor.fetchone()
        
        if not user or user['Deposit_Balance'] < amount:
            raise ValueError('Insufficient balance')
        
        # Update balances
        cursor.execute(
            'UPDATE Users SET Deposit_Balance = Deposit_Balance - %s, Stake_Balance = Stake_Balance + %s WHERE Telegram_User_ID = %s',
            (amount, amount, user_id)
        )
        
        conn.commit()
        return jsonify({'success': True})
    
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 400
    
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

def get_telegram_username(user_id):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChat?chat_id={user_id}"
    response = requests.get(url).json()
    if response.get("ok"):
        return response["result"].get("username", "N/A")
    return "N/A"

def get_user_data(telegram_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT Telegram_User_ID, Deposit_Balance, Stake_Balance, Ref_ID 
        FROM Users WHERE Telegram_User_ID = %s
    """, (telegram_id,))
    user_data = cursor.fetchone()
    conn.close()
    if not user_data:
        return None
    return {
        "Telegram_User_ID": user_data[0],
        "Deposit_Balance": user_data[1],
        "Stake_Balance": user_data[2],
        "Referral_By": get_telegram_username(user_data[4]) if user_data[4] else None
    }

@app.route("/get_user", methods=["GET"])
def get_user():
    telegram_id = request.args.get("telegram_id")
    if not telegram_id:
        return jsonify({"error": "telegram_id is required"}), 400
    
    user_data = get_user_data(telegram_id)
    if not user_data:
        return jsonify({"error": "User not found"}), 404
    
    user_data["Telegram_Username"] = get_telegram_username(telegram_id)
    return jsonify(user_data)


if __name__ == "__main__":
    app.run(ssl_context= ("leostar.live.crt", "private.key"), host="0.0.0.0", debug=True, port=5001)