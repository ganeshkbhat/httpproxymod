const {
  certs: {getCerts}  
} = require('../index.js');
const { servers: {  udpProxy: createUdpProxyServer } } = require('../index.js');


function startUdpProxyServer(udpPortOrOptions = 41210, tlsPortOrHandlers = 8004, tlsHost = '127.0.0.1') {
  const certs = getCerts();
  let udpPort = 41210;
  let tlsPort = 8004;
  let host = tlsHost;
  let handlers = null;
  let extraOptions = {};

  if (typeof udpPortOrOptions === 'object' && udpPortOrOptions !== null) {
    udpPort = udpPortOrOptions.udpPort || udpPortOrOptions.port || 41210;
    tlsPort = udpPortOrOptions.protocolPort || udpPortOrOptions.targetPort || 8004;
    host = udpPortOrOptions.protocolHost || udpPortOrOptions.host || '127.0.0.1';
    extraOptions = udpPortOrOptions;
    handlers = tlsPortOrHandlers;
  } else {
    udpPort = udpPortOrOptions;
    tlsPort = tlsPortOrHandlers;
  }

  const udpProxyServer = createUdpProxyServer(
    {
      udpPort: udpPort,
      udpHost: '127.0.0.1',
      protocol: 'tls',
      protocolHost: host,
      protocolPort: tlsPort,
      rejectUnauthorized: false,
      key: certs.key,
      cert: certs.cert,
      autoClose: true,
      ...extraOptions
    },
    handlers
  );

  console.log(`[UDP Proxy Server] Listening on udp://127.0.0.1:${udpPort} forwarding to tls://${host}:${tlsPort}`);
  return udpProxyServer;
}

if (require.main === module) {
  const TLS_PORT = process.env.TLS_PORT ? parseInt(process.env.TLS_PORT, 10) : 8004;
  const UDP_PORT = process.env.UDP_PORT ? parseInt(process.env.UDP_PORT, 10) : 41210;
  const TLS_HOST = process.env.TLS_HOST || '127.0.0.1';

  startUdpProxyServer(UDP_PORT, TLS_PORT, TLS_HOST);
}

module.exports = {
  startUdpProxyServer
};