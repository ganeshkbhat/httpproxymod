const { createHttpServer: createServer } = require('../index');

function createHttpServer(port = 9007, onData) {
  const defaultOnData = (data) => ({
    protocol: 'HTTP',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { message: 'Hello from HTTP Server', echo: data }
  });

  const dataHandler = onData || defaultOnData;

  const handler = (req, res, httpRequestDetails) => {
    const data = httpRequestDetails || { method: req.method, url: req.url, headers: req.headers, body: '' };
    console.log('[HTTP Server] Received request data:', data);

    const response = dataHandler(data);
    res.writeHead(response.status || 200, response.headers || { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response.body));
  };

  const { server } = createServer({ port, useHttps: false }, handler);
  return server;
}

if (require.main === module) {
  createHttpServer();
}

module.exports = { createHttpServer };