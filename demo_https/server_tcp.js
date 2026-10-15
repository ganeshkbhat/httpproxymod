const { servers: { tcp: createTcpServer } } = require('../index');

function createTcpServerWrapper(port = 9001, customHandlers = {}) {
  const serverInstance = createTcpServer({
    port: port,
    host: '127.0.0.1',
    onConnect: (socket, server) => {
      if (typeof customHandlers.onConnect === 'function') {
        customHandlers.onConnect(socket, server);
      } else if (typeof customHandlers.onConnection === 'function') {
        customHandlers.onConnection(socket, server);
      }
    },
    onConnection: (socket, server) => {
      if (typeof customHandlers.onConnection === 'function') {
        customHandlers.onConnection(socket, server);
      } else if (typeof customHandlers.onConnect === 'function') {
        customHandlers.onConnect(socket, server);
      }
    },
    onData: async (requestData, socket, server, packet) => {
      let data = requestData;
      if (typeof customHandlers.onData === 'function') {
        data = await customHandlers.onData(data, socket, server, packet);
      } else if (typeof customHandlers.onMessage === 'function') {
        data = await customHandlers.onMessage(data, socket, server, packet);
      }

      const method = (packet && packet.payload && packet.payload.method) || (data && data.method) || 'GET';
      const url = (packet && packet.payload && packet.payload.url) || (data && data.url) || '/';

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          success: true,
          method: method,
          url: url,
          data: data
        }
      };
    },
    onMessage: async (requestData, socket, server, packet) => {
      let data = requestData;
      if (typeof customHandlers.onMessage === 'function') {
        data = await customHandlers.onMessage(data, socket, server, packet);
      } else if (typeof customHandlers.onData === 'function') {
        data = await customHandlers.onData(data, socket, server, packet);
      }
      return data;
    },
    onError: (err, messageBuffer, socket, server) => {
      if (typeof customHandlers.onError === 'function') {
        customHandlers.onError(err, messageBuffer, socket, server);
      } else {
        console.error('[TCP Server Error]:', err.message);
      }
    },
    onClose: (hadError, socket, server) => {
      if (typeof customHandlers.onClose === 'function') {
        customHandlers.onClose(hadError, socket, server);
      }
    },
    onDestroy: (socket, server) => {
      if (typeof customHandlers.onDestroy === 'function') {
        customHandlers.onDestroy(socket, server);
      }
    }
  });

  const originalClose = serverInstance.close;
  serverInstance.close = (callback) => {
    if (serverInstance.server && serverInstance.server.listening) {
      originalClose(callback);
    } else if (typeof callback === 'function') {
      callback();
    }
  };

  return serverInstance;
}

if (require.main === module) {
  createTcpServerWrapper();
}

module.exports = { createTcpServer: createTcpServerWrapper };