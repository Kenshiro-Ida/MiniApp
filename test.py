from flask import Flask, jsonify, request
from web3 import Web3

app = Flask(__name__)

# Set up Web3 connection to Sepolia testnet
INFURA_URL = 'https://sepolia.infura.io/v3/0xC51533Ee857B5c381F6c960Ab41Dc0c31CECc183'
web3 = Web3(Web3.HTTPProvider(INFURA_URL))

# Check if connected to the network using block details
try:
    # Try fetching the latest block
    web3.eth.get_block('latest')
    print("Connected to Sepolia Testnet")
except Exception as e:
    print(f"Failed to connect to Sepolia Testnet: {e}")
    exit()

@app.route('/get_transfers', methods=['GET'])
def get_transfers():
    wallet_address = request.args.get('wallet_address')
    
    # if not wallet_address or not web3.isAddress(wallet_address):
    #     return jsonify({'error': 'Invalid wallet address'}), 400
    
    # Fetch block details
    latest_block = web3.eth.get_block('latest')
    block_number = latest_block['number']
    
    transfers = []
    
    # Scan past blocks for transactions
    for block_num in range(block_number, 0, -1):
        block = web3.eth.get_block(block_num, full_transactions=True)
        for txn in block['transactions']:
            # Ensure 'from' and 'to' addresses are not None
            from_address = txn.get('from')
            to_address = txn.get('to')
            
            if from_address and to_address:  # Only process if both addresses exist
                # Check if the wallet is involved in the transaction
                if from_address.lower() == wallet_address.lower() or to_address.lower() == wallet_address.lower():
                    transfers.append({
                        'block_number': block_num,
                        'transaction_hash': txn['hash'].hex(),
                        'from': from_address,
                        'to': to_address,
                        'value': web3.fromWei(txn['value'], 'ether'),
                        'gas': txn['gas'],
                        'gas_price': web3.fromWei(txn['gasPrice'], 'gwei'),
                        'timestamp': web3.eth.get_block(block_num)['timestamp']
                    })
    
    return jsonify({'transfers': transfers})

if __name__ == '__main__':
    app.run(debug=True, port=5000)