const { servers } = require('../index.js');

function createTargetWsServer(port = 8006) {
  return servers.ws({ port }, {
    onData: async (payload, socket, server, frame) => {
      try {
        console.log('[WS Target Server] Received payload:', payload);

        // payload is already parsed JSON from createWsServer
        const reqBody = payload.body 
          ? (typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body) 
          : payload;

        const responseObj = {
          server: 'WS Target Server',
          received: reqBody,
          timestamp: Date.now()
        };

        // Return a response object so createWsServer automatically 
        // attaches the __reqId and responds to the WebSocket client.
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(responseObj)
        };
      } catch (e) {
        console.error('[WS Target Error]', e);
        return {
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Internal WS Server Error', details: e.message })
        };
      }
    }
  });
}

if (require.main === module) {
  createTargetWsServer(8006);
  console.log('[WS Target Server] Running on port 8006');
}

module.exports = { createTargetWsServer };