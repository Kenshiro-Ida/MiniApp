const { Web3 } = require('web3');

const web3 = new Web3('https://sepolia.infura.io/v3/bfa7d79d684e465e8cf63b10f095c450');

const address = '0x11f4d0A3c12e86B4b5F39B213F7E19D048276DAe';
const topics = ['0x033456732123ffff2342342dd12342434324234234fd234fd23fd4f23d4234'];

web3.eth.getPastLogs({
    address: address,
    topics: topics
  })
  .then(logs => {
    logs.forEach(log => {
      console.log("Log Data:", log.data);
      console.log("Log Topics:", log.topics);
      console.log("Transaction Hash:", log.transactionHash);
      console.log("Block Number:", log.blockNumber);
      console.log("Block Hash:", log.blockHash);
      console.log("Log Index:", log.logIndex);
      console.log("Transaction Index:", log.transactionIndex);
      console.log("Address:", log.address);
      console.log("------------------------------");
    });
  })
  .catch(error => {
    console.error("Error fetching logs:", error);
  });