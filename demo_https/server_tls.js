const { servers: { tls: createTlsServer }, certs: { getOrGenerateSelfSignedCert }, helpers: { resolveLifeCycleHandlers } } = require('../index');

function createTlsServerWrapper(port = 9002, customHandlers = {}) {
  const certs = getOrGenerateSelfSignedCert();
  const handlers = resolveLifeCycleHandlers(customHandlers);

  const serverInstance = createTlsServer({
    port: port,
    host: '127.0.0.1',
    key: certs.key,
    cert: certs.cert,
    rejectUnauthorized: false,
    onConnect: handlers.onConnect,
    onConnection: handlers.onConnection,
    onData: async (requestData, socket, server, packet) => {
      let data = requestData;
      if (typeof handlers.onData === 'function') {
        data = await handlers.onData(data, socket, server, packet);
      }
      return data;
    },
    onMessage: async (requestData, socket, server, packet) => {
      let data = requestData;
      if (typeof handlers.onMessage === 'function') {
        data = await handlers.onMessage(data, socket, server, packet);
      }
      return data;
    },
    onEnd: (socket, server) => {
      if (typeof handlers.onEnd === 'function') {
        handlers.onEnd(socket, server);
      }
    },
    onError: (err, messageBuffer, socket, server) => {
      if (typeof handlers.onError === 'function') {
        handlers.onError(err, messageBuffer, socket, server);
      } else {
        console.error('[TLS Server Error]:', err.message);
      }
    },
    onClose: (hadError, socket, server) => {
      if (typeof handlers.onClose === 'function') {
        handlers.onClose(hadError, socket, server);
      }
    },
    onDestroy: (socket, server) => {
      if (typeof handlers.onDestroy === 'function') {
        handlers.onDestroy(socket, server);
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