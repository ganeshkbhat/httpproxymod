const dgram = require('dgram');

function createUdpServer(port = 9001, onMessage) {
  const defaultOnMessage = (data) => ({
    protocol: 'UDP',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { message: 'Hello from UDP Server', echo: data }
  });

  const messageHandler = onMessage || defaultOnMessage;
  const server = dgram.createSocket('udp4');

  server.on('message', (msg, rinfo) => {
    const data = JSON.parse(msg.toString('utf-8'));
    console.log('[UDP Server] Received message:', data);

    const response = messageHandler(data);
    const responseBuffer = Buffer.from(JSON.stringify(response));
    server.send(responseBuffer, rinfo.port, rinfo.address);
  });

  server.bind(port, '127.0.0.1', () => {
    console.log(`[UDP Target Server] Listening on 127.0.0.1:${port}`);
  });

  return server;
}

if (require.main === module) {
  createUdpServer();
}

module.exports = { createUdpServer };