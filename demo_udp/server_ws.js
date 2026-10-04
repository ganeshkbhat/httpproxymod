const { servers, parseWsFrames, buildWsFrame } = require('../index.js');

function createTargetWsServer(port = 8081) {
  return servers.ws({ port }, {
    onData: async (frame, socket) => {
      if (frame.opcode === 0x01 || frame.opcode === 0x02) {
        try {
          const reqPayload = JSON.parse(frame.payload.toString());
          const resObj = {
            server: 'WS Target Server',
            status: 200,
            body: JSON.stringify({ received: reqPayload })
          };
          if (reqPayload.__reqId !== undefined) {
            resObj.__reqId = reqPayload.__reqId;
          }
          socket.write(buildWsFrame(Buffer.from(JSON.stringify(resObj))));
        } catch (e) {
          console.error('[WS Target Error]', e);
        }
      }
    }
  });
}

if (require.main === module) {
  createTargetWsServer(8081);
}

module.exports = { createTargetWsServer };