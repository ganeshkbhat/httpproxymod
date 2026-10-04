const { servers } = require('../index.js');

function createTargetUdpServer(port = 41235) {
  return servers.udp({ port, host: '127.0.0.1' }, async (msg, rinfo, server) => {
    let parsed;
    try {
      parsed = JSON.parse(msg.toString());
    } catch (e) {
      parsed = { body: msg.toString() };
    }
    const response = {
      correlationId: parsed.correlationId,
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: 'UDP Target Server', echo: parsed })
    };
    server.send(Buffer.from(JSON.stringify(response)), rinfo.port, rinfo.address);
  });
}

if (require.main === module) {
  createTargetUdpServer(41235);
}

module.exports = { createTargetUdpServer };