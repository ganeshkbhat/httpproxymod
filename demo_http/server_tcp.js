const { servers: { tcp: createTcpServer } } = require('../index');

function createTcpServerWrapper(port = 8003, customHandlers = {}) {
  const serverInstance = createTcpServer({
    port: port,
    host: '127.0.0.1',
    onConnect: (socket, server) => {
      console.log('[TCP Target Server] Client connected');
      if (typeof customHandlers.onConnection === 'function') {
        customHandlers.onConnection(socket, server);
      } else if (typeof customHandlers.onConnect === 'function') {
        customHandlers.onConnect(socket, server);
      }
    },
    onData: async (requestData, socket, server, packet) => {
      console.log('[TCP Target Server] Received request data:', requestData);
      if (typeof customHandlers.onData === 'function') {
        return await customHandlers.onData(requestData, socket, server, packet);
      } else if (typeof customHandlers.onMessage === 'function') {
        return await customHandlers.onMessage(requestData, socket, server, packet);
      }

      const method = (requestData.method || 'GET').toUpperCase();
      const url = requestData.url || '/';
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          success: true,
          method: method,
          url: url,
          message: `Successfully processed ${method} request`,
          receivedBody: requestData.body || null,
          timestamp: new Date().toISOString()
        }
      };
    },
    onEnd: (socket, server) => {
      console.log('[TCP Target Server] Client ended connection');
      if (typeof customHandlers.onEnd === 'function') {
        customHandlers.onEnd(socket, server);
      }
    },
    onClose: (hadError, socket, server) => {
      console.log('[TCP Target Server] Socket closed', hadError);
      if (typeof customHandlers.onClose === 'function') {
        customHandlers.onClose(hadError, socket, server);
      } else if (typeof customHandlers.onDestroy === 'function') {
        customHandlers.onDestroy(hadError, socket, server);
      }
    },
    onError: (err, messageBuffer, socket, server) => {
      console.error('[TCP Target Server] Error:', err.message);
      if (typeof customHandlers.onError === 'function') {
        customHandlers.onError(err, messageBuffer, socket, server);
      }
    }
  });

  return serverInstance;
}

if (require.main === module) {
  createTcpServerWrapper();
}

module.exports = { createTcpServer: createTcpServerWrapper };