const { servers } = require('../index');

function createWsServer(port = 8006, onMessage) {
  const defaultOnMessage = (message) => ({
    protocol: 'WS',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: {
      message: 'Hello from WS Server',
      wsEcho: message.url || message.body
    }
  });

  const messageHandler = onMessage || defaultOnMessage;

  const wsServer = servers.ws({ port }, async (msg, socket, server) => {
    console.log('[WS Server] Received message:', msg);
    const response = await messageHandler(msg);
    return response;
  });

  console.log(`[WS Target Server] Listening on 127.0.0.1:${port}`);
  return wsServer.server;
}

if (require.main === module) {
  createWsServer();
}

module.exports = { createWsServer };