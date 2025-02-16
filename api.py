from flask import Flask, request, jsonify
import mysql.connector

app = Flask(__name__)

# Database connection settings
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "123456",
    "database": "pocket_money",
    "port": 3306
}

# Function to get database connection
def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG)

@app.route("/get_balance", methods=["GET"])
def get_balance():
    telegram_user_id = request.args.get("telegram_user_id")
    
    if not telegram_user_id:
        return jsonify({"error": "Missing telegram_user_id"}), 400
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        
        query = """
        SELECT Deposit_Balance, Stake_Balance FROM Users WHERE Telegram_User_ID = %s
        """
        cursor.execute(query, (telegram_user_id,))
        user_data = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        if user_data:
            return jsonify({"telegram_user_id": telegram_user_id, "Deposit_Balance": user_data["Deposit_Balance"], "Stake_Balance": user_data["Stake_Balance"]})
        else:
            return jsonify({"error": "User not found"}), 404
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(ssl_context= ("leostar.live.crt", "private.key"), host="0.0.0.0", debug=True, port=5001)
