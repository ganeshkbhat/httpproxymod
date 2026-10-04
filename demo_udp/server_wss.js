const { servers, parseWsFrames, buildWsFrame, getCerts } = require('../index.js');

function createTargetWssServer(port = 8443, certs) {
  const resolvedCerts = certs || getCerts();
  return servers.wss({
    port,
    key: resolvedCerts.key,
    cert: resolvedCerts.cert,
    rejectUnauthorized: false
  }, {
    onData: async (frame, socket) => {
      if (frame.opcode === 0x01 || frame.opcode === 0x02) {
        try {
          const reqPayload = JSON.parse(frame.payload.toString());
          const resObj = {
            server: 'WSS Target Server',
            status: 200,
            body: JSON.stringify({ received: reqPayload })
          };
          if (reqPayload.__reqId !== undefined) {
            resObj.__reqId = reqPayload.__reqId;
          }
          socket.write(buildWsFrame(Buffer.from(JSON.stringify(resObj))));
        } catch (e) {
          console.error('[WSS Target Error]', e);
        }
      }
    }
  });
}

if (require.main === module) {
  try {
    createTargetWssServer(8443);
  } catch (e) {
    console.error('Please generate key.pem and cert.pem first.', e);
  }
}

module.exports = { createTargetWssServer };