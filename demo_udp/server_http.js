const { createHttpServer } = require('../index.js');

function createTargetHttpServer(port = 8080) {
  return createHttpServer({
    port,
    requestHandler: async (req, res, details) => {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          server: 'HTTP Target Server',
          method: details.method,
          url: details.url,
          headers: details.headers,
          body: details.body
        })
      };
    }
  });
}

if (require.main === module) {
  createTargetHttpServer(process.env.PORT ? parseInt(process.env.PORT) : 8080);
}

module.exports = { createTargetHttpServer };