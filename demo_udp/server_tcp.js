const { servers } = require('../index.js');

/**
 * Creates a TCP target server using built-in servers.tcp from index.js
 */
function createTargetTcpServer(port = 8003, customHandlers = {}) {
  return servers.tcp({ port, host: '127.0.0.1' }, {
    onConnect: (socket, server) => {
      console.log(`[TCP Target Server] Client connected from ${socket.remoteAddress}:${socket.remotePort}`);
      if (typeof customHandlers.onConnect === 'function') {
        customHandlers.onConnect(socket, server);
      }
    },
    onData: async (requestData, socket, server, packet) => {
      if (typeof customHandlers.onData === 'function') {
        return await customHandlers.onData(requestData, socket, server, packet);
      }

      console.log('[TCP Target Server] Parsed packet payload:', requestData);

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ server: 'TCP Target Server', received: requestData })
      };
    },
    onEnd: (socket, server) => {
      console.log('[TCP Target Server] Client ended connection');
      if (typeof customHandlers.onEnd === 'function') {
        customHandlers.onEnd(socket, server);
      }
    },
    onClose: (hadError, socket, server) => {
      console.log(`[TCP Target Server] Socket closed (hadError: ${hadError})`);
      if (typeof customHandlers.onClose === 'function') {
        customHandlers.onClose(hadError, socket, server);
      }
    },
    onError: (err, chunk, socket, server) => {
      console.error('[TCP Target Server] Socket error:', err.message);
      if (typeof customHandlers.onError === 'function') {
        customHandlers.onError(err, chunk, socket, server);
      }
    }
  });
}

if (require.main === module) {
  createTargetTcpServer(8003);
}

module.exports = { createTargetTcpServer };