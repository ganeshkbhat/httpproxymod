const { createHttpServer: createServer } = require('../index');
const { generateSelfSignedCert } = require('../index');

function createHttpsServer(port = 9008, onData) {
  const defaultOnData = (data) => ({
    protocol: 'HTTPS',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { message: 'Hello from HTTPS Server', echo: data }
  });

  const dataHandler = onData || defaultOnData;
  const keys = generateSelfSignedCert();

  const handler = (req, res, httpRequestDetails) => {
    const data = httpRequestDetails || { method: req.method, url: req.url, headers: req.headers, body: '' };
    console.log('[HTTPS Server] Received request data:', data);

    const response = dataHandler(data);
    res.writeHead(response.status || 200, response.headers || { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response.body));
  };

  const { server } = createServer({
    port,
    useHttps: true,
    key: keys.key,
    cert: keys.cert
  }, handler);

  return server;
}

if (require.main === module) {
  createHttpsServer();
}

module.exports = { createHttpsServer };