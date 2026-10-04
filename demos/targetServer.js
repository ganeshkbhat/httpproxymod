const { createHttpServer } = require('../index');

const targetServerInfo = createHttpServer({
  port: 9000,
  requestHandler: async (req, res, httpRequestDetails) => {
    console.log(`[Target Server] Received ${httpRequestDetails.method} request at ${httpRequestDetails.url}`);
    res.send({
      message: 'Hello from target HTTP server!',
      receivedData: httpRequestDetails.body ? JSON.parse(httpRequestDetails.body) : null
    });
  }
});