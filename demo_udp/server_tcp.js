const { servers, parseStreamFrames, frameStreamMessage } = require('../index.js');

function createTargetTcpServer(port = 7000) {
  let rxBuffer = Buffer.alloc(0);
  return servers.tcp({ port, host: '127.0.0.1' }, {
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
            body: JSON.stringify({ server: 'TCP Target Server', received: packet.payload })
          };
          socket.write(frameStreamMessage(Buffer.from(JSON.stringify(response))));
        } catch (err) {
          console.error('[TCP Target Error]', err);
        }
      });
    }
  });
}

if (require.main === module) {
  createTargetTcpServer(7000);
}

module.exports = { createTargetTcpServer };