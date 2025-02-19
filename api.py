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

        query = "SELECT Deposit_Balance, Stake_Balance, Withdrawal_Balance FROM Users WHERE Telegram_User_ID = %s"
        cursor.execute(query, (telegram_user_id,))
        user_data = cursor.fetchone()

        cursor.close()
        conn.close()

        if user_data:
            # Convert balances to float to ensure they are numbers
            deposit_balance = float(user_data["Deposit_Balance"]) if user_data["Deposit_Balance"] is not None else 0.0
            stake_balance = float(user_data["Stake_Balance"]) if user_data["Stake_Balance"] is not None else 0.0
            withdraw_balance = float(user_data["Withdrawal_Balance"]) if user_data["Withdrawal_Balance"] is not None else 0.0

            # Trigger a manual check for new transactions via the Node.js server
            try:
                requests.get(f"http://localhost:3001/check-transactions?userId={telegram_user_id}")
            except:
                # Continue even if the request fails
                pass

            return jsonify({
                "telegram_user_id": telegram_user_id,
                "Deposit_Balance": deposit_balance,
                "Stake_Balance": stake_balance,
                "Withdraw_Balance": withdraw_balance
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
        
        # Log the transaction
        cursor.execute(
            'INSERT INTO Deposit_Transactions (Telegram_User_ID, Deposit_Date, Dr_Amount, Cr_Amount, Balance, Transation_Type) '
            'VALUES (%s, NOW(), %s, 0, (SELECT Deposit_Balance FROM Users WHERE Telegram_User_ID = %s), "Stake")',
            (user_id, amount, user_id)
        )
        
        conn.commit()
        
    
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
        SELECT Telegram_User_ID, Deposit_Balance, Stake_Balance, Withdrawal_Balance, Ref_ID, created_at 
        FROM Users WHERE Telegram_User_ID = %s
    """, (telegram_id,))
    user_data = cursor.fetchone()
    conn.close()
    if not user_data:
        return None
    return {
        "Telegram_User_ID": user_data[0],
        "Deposit_Balance": float(user_data[1]) if user_data[1] is not None else 0.0,
        "Stake_Balance": float(user_data[2]) if user_data[2] is not None else 0.0,
        "Withdrawal_Balance": float(user_data[3]) if user_data[3] is not None else 0.0,
        "Referral_By": get_telegram_username(user_data[4]) if user_data[4] else None,
        "Joining_Date": user_data[5]
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

@app.route("/get_deposits", methods=["GET"])
def get_deposits():
    telegram_user_id = request.args.get("telegram_user_id")
    
    if not telegram_user_id:
        return jsonify({"error": "Missing telegram_user_id"}), 400

    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        
        # First get user balance
        cursor.execute("SELECT Deposit_Balance FROM Users WHERE Telegram_User_ID = %s", (telegram_user_id,))
        user = cursor.fetchone()
        print(user)
        print("Balance = ", float(user["Deposit_Balance"]))
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        # Then get transactions
        query = """
        SELECT *
        FROM 
            Deposit_Transactions
        WHERE
            Telegram_User_ID = %s
        ORDER BY
            Deposit_Date DESC
        """
        cursor.execute(query, (telegram_user_id,))
        transactions = cursor.fetchall()
        
        
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "balance": float(user["Deposit_Balance"]),
            "transactions": transactions
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/process_withdrawal", methods=["POST"])
def process_withdrawal():
    data = request.get_json()
    
    telegram_user_id = data.get("telegram_user_id")
    wallet_address = data.get("wallet_address")
    amount = float(data.get("amount", 0))
    
    if not telegram_user_id or not wallet_address or amount <= 0:
        return jsonify({"error": "Missing required parameters"}), 400
    
    conn = None
    cursor = None
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        
        # Start transaction
        conn.start_transaction()
        
        # Check if user has sufficient balance
        cursor.execute(
            'SELECT Withdrawal_Balance FROM Users WHERE Telegram_User_ID = %s', (telegram_user_id,)
        )
        user = cursor.fetchone()
        
        if not user or user['Withdrawal_Balance'] < amount:
            raise ValueError('Insufficient withdrawal balance')
        
        # Update balance
        cursor.execute(
            'UPDATE Users SET Withdrawal_Balance = Withdrawal_Balance - %s WHERE Telegram_User_ID = %s',
            (amount, telegram_user_id)
        )
        
        # Log the withdrawal transaction
        cursor.execute(
            'INSERT INTO Deposit_Transactions (Telegram_User_ID, Deposit_Date, Dr_Amount, Cr_Amount, Balance, Transation_Type) '
            'VALUES (%s, NOW(), %s, 0, (SELECT Withdrawal_Balance FROM Users WHERE Telegram_User_ID = %s), "Withdrawal")',
            (telegram_user_id, amount, telegram_user_id)
        )
        
        conn.commit()
        
    
        
        return jsonify({'success': True, 'message': 'Withdrawal processed successfully'})
    
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 400
    
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.route("/get_referrals", methods=["GET"])
def get_referrals():
    telegram_id = request.args.get("telegram_id")
    if not telegram_id:
        return jsonify({"error": "telegram_id is required"}), 400
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        
        # Get user's referrer
        cursor.execute("SELECT Ref_ID FROM Users WHERE Telegram_User_ID = %s", (telegram_id,))
        user = cursor.fetchone()
        referred_by = None
        if user and user["Ref_ID"]:
            referred_by = get_telegram_username(user["Ref_ID"])
        
        # Get users referred by this user
        cursor.execute("SELECT Telegram_User_ID FROM Users WHERE Ref_ID = %s", (telegram_id,))
        referrals = cursor.fetchall()
        
        referral_data = []
        total_earnings = 0
        
        for ref in referrals:
            ref_id = ref["Telegram_User_ID"]
            username = get_telegram_username(ref_id)
            
            # Calculate earnings from this referral
            cursor.execute(
                "SELECT SUM(Cr_Amount) as earnings FROM Deposit_Transactions WHERE Telegram_User_ID = %s AND Transation_Type = 'Referral'",
                (ref_id,)
            )
            earnings_result = cursor.fetchone()
            earnings = float(earnings_result["earnings"]) if earnings_result and earnings_result["earnings"] else 0
            
            total_earnings += earnings
            
            referral_data.append({
                "id": ref_id,
                "username": username,
                "earnings": earnings
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "referred_by": referred_by,
            "total_earnings": total_earnings,
            "referrals": referral_data
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(ssl_context=("leostar.live.crt", "private.key"), host="0.0.0.0", debug=True, port=5001)