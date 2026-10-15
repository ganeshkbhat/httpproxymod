const { servers: { udp: createUdpServer } } = require('../index');

/**
 * Creates and starts a target UDP server wrapper supporting all lifecycle event handlers.
 */
function createUdpServerWrapper(port = 9003, customHandlers = {}) {
  const serverInstance = createUdpServer({
    port: port,
    host: '127.0.0.1',
    onConnect: (server) => {
      console.log(`[UDP Target Server] Listening and ready on port ${port}`);
      if (typeof customHandlers.onConnect === 'function') {
        customHandlers.onConnect(server);
      } else if (typeof customHandlers.onConnection === 'function') {
        customHandlers.onConnection(server);
      }
    },
    onConnection: (server) => {
      if (typeof customHandlers.onConnection === 'function') {
        customHandlers.onConnection(server);
      } else if (typeof customHandlers.onConnect === 'function') {
        customHandlers.onConnect(server);
      }
    },
    onData: async (msg, rinfo, server) => {
      let data = msg;
      if (typeof customHandlers.onData === 'function') {
        data = await customHandlers.onData(data, rinfo, server);
      } else if (typeof customHandlers.onMessage === 'function') {
        data = await customHandlers.onMessage(data, rinfo, server);
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
        if (err && typeof customHandlers.onError === 'function') {
          customHandlers.onError(err, msg, rinfo, server);
        }
      });
    },
    onMessage: async (msg, rinfo, server) => {
      if (typeof customHandlers.onMessage === 'function') {
        return await customHandlers.onMessage(msg, rinfo, server);
      } else if (typeof customHandlers.onData === 'function') {
        return await customHandlers.onData(msg, rinfo, server);
      }
      return msg;
    },
    onError: (err, msg, rinfo, server) => {
      if (typeof customHandlers.onError === 'function') {
        customHandlers.onError(err, msg, rinfo, server);
      } else {
        console.error('[UDP Target Server Error]:', err.message);
      }
    },
    onClose: (server) => {
      if (typeof customHandlers.onClose === 'function') {
        customHandlers.onClose(server);
      }
    },
    onEnd: (server) => {
      if (typeof customHandlers.onEnd === 'function') {
        customHandlers.onEnd(server);
      }
    },
    onDestroy: (server) => {
      if (typeof customHandlers.onDestroy === 'function') {
        customHandlers.onDestroy(server);
      }
    }
  });

  const originalClose = serverInstance.close;
  serverInstance.close = (callback) => {
    if (serverInstance.server) {
      serverInstance.server.close(() => {
        if (typeof customHandlers.onDestroy === 'function') {
          customHandlers.onDestroy(serverInstance.server);
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