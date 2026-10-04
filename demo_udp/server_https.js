const { createHttpServer, getCerts } = require('../index.js');

function createTargetHttpsServer(port = 8443, certs) {
  const resolvedCerts = certs || getCerts();
  return createHttpServer({
    port,
    useHttps: true,
    key: resolvedCerts.key,
    cert: resolvedCerts.cert,
    requestHandler: async (req, res, details) => {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          server: 'HTTPS Target Server',
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
  try {
    createTargetHttpsServer(8443);
  } catch (e) {
    console.error('Please generate key.pem and cert.pem first.', e);
  }
}

module.exports = { createTargetHttpsServer };