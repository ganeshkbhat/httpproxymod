const net = require('net');
const fs = require('fs');
const { frameMessage, parseFrames } = require('../index');

const DEFAULT_SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\demo_socket'
  : '/tmp/demo_socket.sock';

function createUnixSocketServer(socketPath = DEFAULT_SOCKET_PATH, onData) {
  const defaultOnData = (data) => ({
    protocol: 'UNIX_SOCKET',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { message: 'Hello from Unix Socket Server', echo: data }
  });

  const dataHandler = onData || defaultOnData;

  if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch (_) {}
  }

  const server = net.createServer((socket) => {
    let rxBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      rxBuffer = parseFrames(rxBuffer, (messageBuffer) => {
        const data = JSON.parse(messageBuffer.toString('utf-8'));
        console.log('[Unix Socket Server] Received data:', data);

        const response = dataHandler(data);
        socket.write(frameMessage(Buffer.from(JSON.stringify(response))));
      });
    });
  });

  server.listen(socketPath, () => {
    console.log(`[Unix Socket Target Server] Listening on ${socketPath}`);
  });

  return server;
}

if (require.main === module) {
  createUnixSocketServer();
}

module.exports = { createUnixSocketServer };