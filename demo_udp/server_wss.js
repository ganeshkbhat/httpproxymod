const { servers, getCerts } = require('../index.js');

function createTargetWssServer(port = 8007, certs) {
  const resolvedCerts = certs || getCerts();
  return servers.wss({
    port,
    key: resolvedCerts.key,
    cert: resolvedCerts.cert,
    rejectUnauthorized: false // Ensure server-side trust configuration allows self-signed negotiation
  }, {
    onData: async (payload, socket, server, frame) => {
      try {
        console.log('[WSS Target] Received payload:', payload);
        
        // Extract request ID if present
        const reqId = payload.__reqId;

        const resObj = {
          server: 'WSS Target Server',
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: {
            received: payload
          }
        };

        if (reqId !== undefined) {
          resObj.body.__reqId = reqId;
        }

        return resObj;
      } catch (e) {
        console.error('[WSS Target Error]', e);
        return {
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: { error: 'Internal Server Error', details: e.message }
        };
      }
    }
  });
}

if (require.main === module) {
  try {
    createTargetWssServer(8007);
  } catch (e) {
    console.error('Please generate key.pem and cert.pem first.', e);
  }
}

module.exports = { createTargetWssServer };