const { servers: { tls: createTlsServer }, certs: { getOrGenerateSelfSignedCert } } = require('../index');

function createTlsServerWrapper(port = 9002, customHandlers = {}) {
  const certs = getOrGenerateSelfSignedCert();

  const serverInstance = createTlsServer({
    port: port,
    host: '127.0.0.1',
    key: certs.key,
    cert: certs.cert,
    rejectUnauthorized: false,
    onConnection: (socket, server) => {
      if (typeof customHandlers.onConnection === 'function') {
        customHandlers.onConnection(socket, server);
      } else if (typeof customHandlers.onConnect === 'function') {
        customHandlers.onConnect(socket, server);
      }
    },
    onConnect: (socket, server) => {
      if (typeof customHandlers.onConnect === 'function') {
        customHandlers.onConnect(socket, server);
      } else if (typeof customHandlers.onConnection === 'function') {
        customHandlers.onConnection(socket, server);
      }
    },
    onData: async (requestData, socket, server, packet) => {
      if (typeof customHandlers.onData === 'function') {
        return await customHandlers.onData(requestData, socket, server, packet);
      } else if (typeof customHandlers.onMessage === 'function') {
        return await customHandlers.onMessage(requestData, socket, server, packet);
      }
      return requestData;
    },
    onMessage: async (requestData, socket, server, packet) => {
      if (typeof customHandlers.onMessage === 'function') {
        return await customHandlers.onMessage(requestData, socket, server, packet);
      } else if (typeof customHandlers.onData === 'function') {
        return await customHandlers.onData(requestData, socket, server, packet);
      }
      return requestData;
    },
    onResponse: (response, requestDetails) => {
      if (typeof customHandlers.onResponse === 'function') {
        return customHandlers.onResponse(response, requestDetails);
      } else if (typeof customHandlers.onResponseReceived === 'function') {
        return customHandlers.onResponseReceived(response, requestDetails);
      }
      return response;
    },
    onEnd: (socket, server) => {
      if (typeof customHandlers.onEnd === 'function') {
        customHandlers.onEnd(socket, server);
      }
    },
    onError: (err, messageBuffer, socket, server) => {
      if (typeof customHandlers.onError === 'function') {
        customHandlers.onError(err, messageBuffer, socket, server);
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
  createTlsServerWrapper();
}

module.exports = { createTlsServer: createTlsServerWrapper };