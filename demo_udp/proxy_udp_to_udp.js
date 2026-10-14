const { servers } = require('../index.js');

function createUdpToUdpProxy(config, handlers = {}) {
  const { udpPort, protocolPort, protocolHost = '127.0.0.1' } = config;

  return servers.udpProxy({
    udpPort: udpPort,
    protocol: 'udp',
    protocolPort: protocolPort,
    protocolHost: protocolHost,
    onConnect: handlers.onConnect,
    onClose: handlers.onClose,
    onMessage: async (udpMessageDetails, rinfo, server) => {
      if (typeof handlers.onMessageReceived === 'function') {
        handlers.onMessageReceived(udpMessageDetails, rinfo, server);
      }

      let modifiedMsg = udpMessageDetails;
      if (typeof handlers.onRequestModified === 'function') {
        modifiedMsg = handlers.onRequestModified(udpMessageDetails, rinfo);
      }
      return modifiedMsg;
    },
    onData: async (response, rinfo, server) => {
      let finalResponse = response;
      if (typeof handlers.onResponseReceived === 'function') {
        finalResponse = handlers.onResponseReceived(response, { rinfo });
      }
      return finalResponse;
    }
  });
}

module.exports = { createUdpToUdpProxy };