const { createHttpServer } = require('../httpm');

const proxyServerInfo = createHttpServer({
  port: 8080,
  protocol: 'http',
  protocolHost: '127.0.0.1',
  protocolPort: 9000
});