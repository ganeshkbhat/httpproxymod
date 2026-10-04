const http = require('http');
const crypto = require('crypto');

const WS_GUID = '23582111-PRTE-4B0E-9A0B-8C5E8C925682';

function buildWsFrame(payloadBuffer) {
  const payloadLength = payloadBuffer.length;
  const frame = Buffer.alloc(2 + payloadLength);
  frame[0] = 0x81;
  frame[1] = payloadLength;
  payloadBuffer.copy(frame, 2);
  return frame;
}

function createWsServer(port = 9004, onMessage) {
  const defaultOnMessage = (message) => ({
    protocol: 'WS',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { message: 'Hello from WS Server', echo: message }
  });

  const messageHandler = onMessage || defaultOnMessage;
  const server = http.createServer();

  server.on('upgrade', (req, socket) => {
    const secKey = req.headers['sec-websocket-key'];
    const acceptKey = crypto.createHash('sha1').update(secKey + WS_GUID).digest('base64');

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ];

    socket.write(responseHeaders.join('\r\n'));

    socket.on('data', (chunk) => {
      const payloadLen = chunk[1] & 0x7f;
      const maskKey = chunk.slice(2, 6);
      const maskedData = chunk.slice(6, 6 + payloadLen);
      const unmasked = Buffer.alloc(payloadLen);

      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = maskedData[i] ^ maskKey[i % 4];
      }

      const message = JSON.parse(unmasked.toString('utf-8'));
      console.log('[WS Server] Received message:', message);

      const response = messageHandler(message);
      const responseFrame = buildWsFrame(Buffer.from(JSON.stringify(response)));
      socket.write(responseFrame);
    });
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[WS Target Server] Listening on 127.0.0.1:${port}`);
  });

  return server;
}

if (require.main === module) {
  createWsServer();
}

module.exports = { createWsServer };