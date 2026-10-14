const { servers } = require('../index');

function startUdpServer(port = 8005) {
  const udpServer = servers.udp({ port }, async (msg, rinfo, server) => {
    try {
      const parsed = JSON.parse(msg.toString('utf-8'));
      console.log('[UDP Server] Received message:', parsed);

      const responsePayload = {
        correlationId: parsed.correlationId,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          message: 'Hello from UDP Server',
          method: parsed.method,
          url: parsed.url,
          echo: parsed.body
        }
      };

      const responseBuffer = Buffer.from(JSON.stringify(responsePayload));
      server.send(responseBuffer, rinfo.port, rinfo.address, (err) => {
        if (err) {
          console.error('[UDP Server] Send error:', err);
        }
      });
    } catch (err) {
      console.error('[UDP Server] Parse/Handle error:', err.message);
    }
  });

  console.log(`[UDP Target Server] Listening on 127.0.0.1:${port}`);
  return udpServer;
}

if (require.main === module) {
  startUdpServer();
}

module.exports = { startUdpServer };