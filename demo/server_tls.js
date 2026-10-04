const tls = require('tls');
const { generateSelfSignedCert } = require('../index');
const { frameMessage, parseFrames } = require('../index');

function createTlsServer(port = 9003, onData) {
  const defaultOnData = (data) => ({
    protocol: 'TLS',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { message: 'Hello from TLS Server', echo: data }
  });

  const dataHandler = onData || defaultOnData;
  const keys = generateSelfSignedCert();

  const server = tls.createServer({
    key: keys.key,
    cert: keys.cert
  }, (socket) => {
    let rxBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      rxBuffer = parseFrames(rxBuffer, (messageBuffer) => {
        const data = JSON.parse(messageBuffer.toString('utf-8'));
        console.log('[TLS Server] Received data:', data);

        const response = dataHandler(data);
        socket.write(frameMessage(Buffer.from(JSON.stringify(response))));
      });
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[TLS Target Server] Listening on 127.0.0.1:${port}`);
  });

  return server;
}

if (require.main === module) {
  createTlsServer();
}

module.exports = { createTlsServer };