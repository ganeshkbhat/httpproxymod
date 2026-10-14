const { servers, DEFAULT_SOCKET_PATH } = require('../index.js');

function createTargetSocketServer(socketPath = DEFAULT_SOCKET_PATH) {
  return servers.socket({ path: socketPath }, {
    onConnect: (socket, server) => {
      console.log(`[Socket Target Server] Client connected on path ${socketPath}`);
    },
    onData: async (requestData, socket, server, packet) => {
      try {
        console.log('[Socket Target Server] Received request data:', requestData);
        
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ 
            server: 'Socket Target Server', 
            received: requestData 
          })
        };
      } catch (err) {
        console.error('[Socket Target Error]', err);
        return {
          status: 500,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Internal Server Error', details: err.message })
        };
      }
    },
    onClose: (hadError, socket, server) => {
      console.log('[Socket Target Server] Client disconnected');
    }
  });
}

if (require.main === module) {
  createTargetSocketServer();
  console.log('[Socket Target Server] Running. Press Ctrl+C to stop.');
}

module.exports = { createTargetSocketServer };