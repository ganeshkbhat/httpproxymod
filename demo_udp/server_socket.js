const { servers, parseStreamFrames, frameStreamMessage, DEFAULT_SOCKET_PATH } = require('../index.js');

function createTargetSocketServer(socketPath = DEFAULT_SOCKET_PATH) {
  let rxBuffer = Buffer.alloc(0);
  return servers.socket({ path: socketPath }, {
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
            body: JSON.stringify({ server: 'Socket Target Server', received: packet.payload })
          };
          socket.write(frameStreamMessage(Buffer.from(JSON.stringify(response))));
        } catch (err) {
          console.error('[Socket Target Error]', err);
        }
      });
    }
  });
}

if (require.main === module) {
  createTargetSocketServer();
}

module.exports = { createTargetSocketServer };