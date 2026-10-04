http proxy to http, https, udp, tls, socket, ws, wss

target http server example

```
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
```

proxy http server to target server example

```
const { createHttpServer } = require('../index');

const proxyServerInfo = createHttpServer({
  port: 8080,
  protocol: 'http',
  protocolHost: '127.0.0.1',
  protocolPort: 9000
});
```

simple client to test proxy forward example

```
const { sendHttpRequest } = require('http-requests-proxy');

async function runClient() {
  console.log('--- Test 1: Direct HTTP Request to Target Server ---');
  try {
    const directResponse = await sendHttpRequest({
      targetUrl: 'http://127.0.0.1:9000/api/direct-test',
      method: 'POST',
      headers: {
        'x-custom-header': 'DirectClient'
      },
      body: { action: 'direct_ping' }
    });

    console.log('Direct Request Status Code:', directResponse.statusCode);
    console.log('Direct Request Response Body:', directResponse.body);
  } catch (err) {
    console.error('Direct Request Error:', err.message);
  }

  console.log('\n--- Test 2: Proxied HTTP Request via Reverse Proxy Server ---');
  try {
    const proxyResponse = await sendHttpRequest({
      targetUrl: 'http://127.0.0.1:8080/api/proxy-test',
      method: 'POST',
      headers: {
        'x-custom-header': 'ProxyClient'
      },
      body: { action: 'proxy_ping' }
    });

    console.log('Proxy Request Status Code:', proxyResponse.statusCode);
    console.log('Proxy Request Response Body:', proxyResponse.body);
  } catch (err) {
    console.error('Proxy Request Error:', err.message);
  }
}

runClient();
```