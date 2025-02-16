import os
import mysql.connector
from web3 import Web3
from eth_account import Account

# Database connection settings
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "Admin@123",
    "database": "pocket_money"
}

# Function to create a wallet
def create_wallet():
    acct = Account.create()
    return acct.address, acct.key.hex()

# Function to insert wallets into the database
def insert_wallets(n):
    try:
        connection = mysql.connector.connect(**DB_CONFIG, auth_plugin='mysql_native_password')
        cursor = connection.cursor()
        
        for _ in range(n):
            address, private_key = create_wallet()
            cursor.execute(
                "INSERT INTO Wallet_Addresses (Wallet_Address, Wallet_PK, Used_Flag) VALUES (%s, %s, %s)",
                (address, private_key, "Unused")
            )
        
        connection.commit()
        print(f"{n} wallets inserted successfully.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if connection:
            cursor.close()
            connection.close()

if __name__ == "__main__":
    n = int(input("Enter the number of wallets to generate: "))
    insert_wallets(n)
