const { servers, parseStreamFrames, frameStreamMessage, getCerts } = require('../index.js');

function createTargetTlsServer(port = 7001, certs) {
  const resolvedCerts = certs || getCerts();
  let rxBuffer = Buffer.alloc(0);

  return servers.tls({
    port,
    host: '127.0.0.1',
    key: resolvedCerts.key,
    cert: resolvedCerts.cert,
    rejectUnauthorized: false
  }, {
    onConnect: () => {
      rxBuffer = Buffer.alloc(0);
    },
    onData: async (chunk, socket) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      rxBuffer = parseStreamFrames(rxBuffer, (messageBuffer) => {
        try {
          const packet = JSON.parse(messageBuffer.toString());
          const response = {
            requestId: packet.requestId,
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ server: 'TLS Target Server', received: packet.payload })
          };
          socket.write(frameStreamMessage(Buffer.from(JSON.stringify(response))));
        } catch (err) {
          console.error('[TLS Target Error]', err);
        }
      });
    }
  });
}

if (require.main === module) {
  try {
    createTargetTlsServer(7001);
  } catch (e) {
    console.error('Please generate key.pem and cert.pem first.', e);
  }
}

module.exports = { createTargetTlsServer };