const net = require('net');
const { frameMessage, parseFrames } = require('../index');

function createTcpServer(port = 9002, onData) {
  const defaultOnData = (data) => ({
    protocol: 'TCP',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { message: 'Hello from TCP Server', echo: data }
  });

  const dataHandler = onData || defaultOnData;

  const server = net.createServer((socket) => {
    let rxBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      rxBuffer = parseFrames(rxBuffer, (messageBuffer) => {
        const data = JSON.parse(messageBuffer.toString('utf-8'));
        console.log('[TCP Server] Received data:', data);

        const response = dataHandler(data);
        socket.write(frameMessage(Buffer.from(JSON.stringify(response))));
      });
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[TCP Target Server] Listening on 127.0.0.1:${port}`);
  });

  return server;
}

if (require.main === module) {
  createTcpServer();
}

module.exports = { createTcpServer };