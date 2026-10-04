http proxy to http, https, udp, tls, socket, ws, wss

all exports from the package to manage and handle proxies

```
{
  // Constants
  DEFAULT_SOCKET_PATH,

  // Direct Server / Request Handlers / Handlers / Clients
  createHttpServer, // Create HTTP or HTTPS server
  createUdpProxyServer, // Create UDP Proxy
  createRequestHandler, // Create request handler for HTTP/S server
  proxyToProtocol, // Generic proxy to protocol switcher
  udpProxyToProtocol, 
  defaultProxyHandler, // Create simple ping request handler for HTTP/S server
  httpProxyHandler, // http proxy handler
  sendHttpRequest, // simple flexible http request creator

  // Certificate Helpers
  generateSelfSignedCert, // generate self signed key and cert 
  getOrGenerateSelfSignedCert, // get key and cert from command line or create one if not provided
  generateAndSaveCerts, // generate and save key and cert in folder
  getCerts, // get key and cert
  certs: {
    generateSelfSignedCert,
    getOrGenerateSelfSignedCert,
    generateAndSaveCerts,
    getCerts
  },

  // Framing Helpers for ws and wss 
  frameMessage,
  parseFrames,
  frameStreamMessage,
  parseStreamFrames,
  framing: {
    frameMessage,
    parseFrames,
    frameStreamMessage,
    parseStreamFrames
  },

  // Server Creators
  servers: {
    udp: createUdpServer, // create UDP server
    udpProxy: createUdpProxyServer, // create UDP Proxy server
    tcp: createTcpServer, // create TCP server
    tls: createTlsServer, // create TLS server
    ws: createWsServer, // create WS server
    wss: createWssServer, // create WSS server
    socket: createSocketServer, // create Socket server
    unix: createSocketServer // create Socket server
  },

  // Client Creators
  clients: {
    udp: createUdpClient, // create UDP Client
    tcp: createTcpClient,  // create TCP Client
    tls: createTlsClient,  // create TLS Client
    http: (opts, handler) => createHttpClient({ ...opts, useHttps: false }, handler),  // create HTTP Client
    https: (opts, handler) => createHttpClient({ ...opts, useHttps: true }, handler),  // create HTTPS Client
    ws: createWsClient,  // create WS Client
    wss: createWssClient,  // create WSS Client
    socket: createSocketClient,  // create Socket Client
    unix: createSocketClient  // create Socket Client
  }
};
```

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