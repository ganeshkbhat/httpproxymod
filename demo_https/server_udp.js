const { servers: { udp: createUdpServer }, helpers: { resolveLifeCycleHandlers } } = require('../index');

function createUdpServerWrapper(port = 9003, customHandlers = {}) {
  const handlers = resolveLifeCycleHandlers(customHandlers);

  const serverInstance = createUdpServer({
    port: port,
    host: '127.0.0.1',
    onConnect: (server) => {
      console.log(`[UDP Target Server] Listening and ready on port ${port}`);
      if (typeof handlers.onConnect === 'function') {
        handlers.onConnect(server);
      }
    },
    onConnection: (server) => {
      if (typeof handlers.onConnection === 'function') {
        handlers.onConnection(server);
      }
    },
    onData: async (msg, rinfo, server) => {
      let data = msg;
      if (typeof handlers.onData === 'function') {
        data = await handlers.onData(data, rinfo, server);
      } else if (typeof handlers.onMessage === 'function') {
        data = await handlers.onMessage(data, rinfo, server);
      }

      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(data.toString('utf-8'));
      } catch (_) {
        parsedPayload = { raw: data.toString('utf-8') };
      }

      const correlationId = parsedPayload.correlationId;
      const method = parsedPayload.method || 'GET';
      const url = parsedPayload.url || '/';

      const responseObj = {
        correlationId: correlationId,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          success: true,
          method: method,
          url: url,
          data: parsedPayload
        })
      };

      server.send(Buffer.from(JSON.stringify(responseObj)), rinfo.port, rinfo.address, (err) => {
        if (err && typeof handlers.onError === 'function') {
          handlers.onError(err, msg, rinfo, server);
        }
      });
    },
    onMessage: async (msg, rinfo, server) => {
      let data = msg;
      if (typeof handlers.onMessage === 'function') {
        data = await handlers.onMessage(data, rinfo, server);
      } else if (typeof handlers.onData === 'function') {
        data = await handlers.onData(data, rinfo, server);
      }
      return data;
    },
    onError: (err, msg, rinfo, server) => {
      if (typeof handlers.onError === 'function') {
        handlers.onError(err, msg, rinfo, server);
      } else {
        console.error('[UDP Server Error]:', err.message);
      }
    },
    onClose: (server) => {
      if (typeof handlers.onClose === 'function') {
        handlers.onClose(server);
      }
    },
    onEnd: (server) => {
      if (typeof handlers.onEnd === 'function') {
        handlers.onEnd(server);
      }
    },
    onDestroy: (server) => {
      if (typeof handlers.onDestroy === 'function') {
        handlers.onDestroy(server);
      }
    }
  });

  const originalClose = serverInstance.close;
  serverInstance.close = (callback) => {
    if (serverInstance.server) {
      serverInstance.server.close(() => {
        if (typeof handlers.onDestroy === 'function') {
          handlers.onDestroy(serverInstance.server);
        }
        if (typeof callback === 'function') callback();
      });
    } else if (typeof callback === 'function') {
      callback();
    }
  };

  return serverInstance;
}

if (require.main === module) {
  createUdpServerWrapper();
}

module.exports = { createUdpServer: createUdpServerWrapper };