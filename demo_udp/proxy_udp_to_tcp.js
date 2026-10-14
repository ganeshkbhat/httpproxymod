const { servers } = require('../index.js');

/**
 * UDP to TCP Proxy Server using built-in servers.udpProxy from index.js
 */
function createUdpToTcpProxy(options = {}, customLifecycle = {}) {
  const targetHost = options.targetHost || options.protocolHost || '127.0.0.1';
  const targetPort = options.targetPort || options.protocolPort || 8003;

  return servers.udpProxy({
    udpHost: options.udpHost || options.host || '127.0.0.1',
    udpPort: options.udpPort || options.port || 41210,
    protocol: 'tcp',
    protocolHost: targetHost,
    protocolPort: targetPort,
    ...options,
    onConnect: (server) => {
      console.log(`[UDP->TCP Proxy] Listening on port ${options.udpPort || options.port || 41210} proxying to TCP ${targetHost}:${targetPort}`);
      if (typeof customLifecycle.onConnect === 'function') {
        customLifecycle.onConnect(server);
      }
    },
    onClose: (server) => {
      console.log(`[UDP->TCP Proxy] Server closed`);
      if (typeof customLifecycle.onClose === 'function') {
        customLifecycle.onClose(server);
      }
    },
    onMessage: async (udpMessageDetails, rinfo, server) => {
      if (typeof customLifecycle.onMessageReceived === 'function') {
        await customLifecycle.onMessageReceived(udpMessageDetails, rinfo, server);
      }

      let messageDetails = udpMessageDetails;
      if (typeof customLifecycle.onRequestModified === 'function') {
        messageDetails = await customLifecycle.onRequestModified(messageDetails, rinfo);
      }
      return messageDetails;
    },
    onData: async (response, rinfo, server) => {
      let res = response;
      if (typeof customLifecycle.onData === 'function') {
        res = await customLifecycle.onData(res, { rinfo });
      }
      return res;
    }
  });
}

if (require.main === module) {
  const proxy = createUdpToTcpProxy();
  console.log('UDP to TCP proxy running. Press Ctrl+C to stop.');
}

module.exports = { createUdpToTcpProxy };