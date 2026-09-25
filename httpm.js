const http = require('http');
const https = require('https');
const { URL } = require('url');

// ============================================================================
// HTTP / HTTPS SERVER MODULE
// ============================================================================

/**
 * Standalone Protocol Proxy Handler.
 * Encapsulates creating/using the protocol client based on `options.createClient` or `options.protocol`.
 *
 * @param {Object} httpRequestDetails - ({ protocol, url, method, headers, body })
 * @param {Object} options - Connection configuration or pre-existing protocol client instance.
 * @returns {Promise<Object>} Resolves with `{ protocolClient, response: { status, headers, body } }`
 */
async function proxyToProtocol(httpRequestDetails, options = {}) {
  let protocolClient;

  if (options.protocolClient) {
    protocolClient = options.protocolClient;
  } else {
    const protocolType = (options.protocol || 'http').toLowerCase();

    if (typeof options.createClient === 'function') {
      // Priority 1: Custom factory function passed by caller
      protocolClient = options.createClient({
        host: options.protocolHost || options.tcpHost || options.udpHost || '127.0.0.1',
        port: options.protocolPort || options.tcpPort || options.udpPort,
        credentials: options.protocolCredentials || options.tcpCredentials || options.udpCredentials
      });
    } else if (protocolType === 'tcp' || protocolType === 'socket') {
      const { createTcpClient } = require('../proxies/http2tcpproxy/htcp');
      protocolClient = createTcpClient({
        host: options.protocolHost || options.tcpHost || '127.0.0.1',
        port: options.protocolPort || options.tcpPort,
        credentials: options.protocolCredentials || options.tcpCredentials
      });
    } else if (protocolType === 'udp') {
      const { createUdpClient } = require('../proxies/http2udpproxy/hudp');
      protocolClient = createUdpClient({
        host: options.protocolHost || options.udpHost || '127.0.0.1',
        port: options.protocolPort || options.udpPort,
        credentials: options.protocolCredentials || options.udpCredentials
      });
    } else if (protocolType === 'websocket' || protocolType === 'ws' || protocolType === 'wss') {
      const { createWsClient } = require('./wsm');
      protocolClient = createWsClient({
        host: options.protocolHost || options.wsHost || '127.0.0.1',
        port: options.protocolPort || options.wsPort,
        credentials: options.protocolCredentials || options.wsCredentials,
        useSsl: protocolType === 'wss'
      });
    } else if (protocolType === 'http' || protocolType === 'https') {
      // Default / HTTP-to-HTTP Passthrough Adapter
      protocolClient = {
        sendHttpRequestPayload: async (details) => {
          const targetHost = options.protocolHost || options.targetHost || '127.0.0.1';
          const targetPort = options.protocolPort || options.targetPort || 80;
          const targetProtocol = options.useHttps || protocolType === 'https' ? 'https' : 'http';
          const targetUrl = `${targetProtocol}://${targetHost}:${targetPort}${details.url}`;

          const res = await sendHttpRequest({
            targetUrl: targetUrl,
            method: details.method,
            headers: details.headers,
            body: details.body
          });

          return {
            status: res.statusCode,
            headers: res.headers,
            body: res.body
          };
        }
      };
    } else {
      throw new Error(`Unsupported protocol type: ${options.protocol}`);
    }
  }

  try {
    const proxyResponse = await protocolClient.sendHttpRequestPayload(httpRequestDetails);
    return {
      protocolClient: protocolClient,
      response: {
        status: proxyResponse.status,
        headers: proxyResponse.headers,
        body: proxyResponse.body
      }
    };
  } catch (err) {
    return {
      protocolClient: protocolClient,
      response: {
        status: 504,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'Gateway Timeout / Protocol Forwarding Failed',
          details: err.message
        })
      }
    };
  }
}

/**
 * Creates the HTTP/HTTPS request handler function.
 * Completely decouples web server protocol handling from the underlying proxy implementation.
 *
 * @param {Function} proxyHandler - Callback function responsible for executing proxy logic.
 * @param {Object} options - Options containing authenticate hook, proxy params, and protocol flags.
 * @param {Function} setProtocolClient - Callback to register the active protocol client.
 * @returns {Function} Standard Node.js `(req, res)` HTTP request listener.
 */
function createRequestHandler(proxyHandler, options, setProtocolClient) {
  const authenticate = options.authenticate;
  const protocol = options.useHttps || (options.key && options.cert) ? 'https' : 'http';

  return (req, res) => {
    const bodyChunks = [];

    req.on('data', (chunk) => {
      bodyChunks.push(chunk);
    });

    req.on('end', async () => {
      const requestBody = Buffer.concat(bodyChunks).toString('utf-8');

      const httpRequestDetails = {
        protocol: protocol,
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: requestBody
      };

      // Step 1: Execute HTTP Server Authentication Hook
      if (typeof authenticate === 'function') {
        const isAllowed = await authenticate(httpRequestDetails);
        if (!isAllowed) {
          res.writeHead(401, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({
            error: 'Unauthorized: HTTP Server custom authentication failed'
          }));
        }
      }

      // Step 2: Delegate to generic proxy handler
      const proxyResult = await proxyHandler(httpRequestDetails, options);
      if (proxyResult && proxyResult.protocolClient) {
        setProtocolClient(proxyResult.protocolResult || proxyResult.protocolClient);
      }

      // Step 3: Dispatch final response stream back to HTTP Client
      const response = proxyResult.response || { status: 500, headers: {}, body: 'Internal Server Error' };
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    });
  };
}

/**
 * Creates and starts an HTTP or HTTPS Reverse Proxy Server.
 *
 * @param {Object} [options={}] - Options.
 * @param {Function} [proxyHandler=proxyToProtocol] - Optional custom proxy function.
 * @returns {Object} `{ server, getProtocolClient: Function }`
 */
function createHttpServer(options = {}, proxyHandler = proxyToProtocol) {
  const port = options.httpPort || options.port || 8080;
  const isHttps = Boolean(options.useHttps || (options.key && options.cert));

  let activeProtocolClient = options.protocolClient || null;
  const setProtocolClient = (client) => {
    activeProtocolClient = client;
  };

  const requestHandler = createRequestHandler(proxyHandler, options, setProtocolClient);

  let server;
  if (isHttps) {
    const tlsOptions = {
      key: options.key,
      cert: options.cert,
      ca: options.ca,
      pfx: options.pfx,
      passphrase: options.passphrase
    };
    server = https.createServer(tlsOptions, requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  server.listen(port, () => {
    const protocolScheme = isHttps ? 'HTTPS' : 'HTTP';
    console.log(`[${protocolScheme} Server HU] Listening on port ${port}`);
  });

  return {
    server: server,
    getProtocolClient: () => activeProtocolClient
  };
}

// ============================================================================
// HTTP / HTTPS CLIENT MODULE
// ============================================================================

/**
 * Sends an HTTP/HTTPS request to Target HTTP Server B.
 * 
 * @param {Object} options - Request configuration.
 * @param {string} options.targetUrl - Full destination URL (e.g., http://localhost:8080/api).
 * @param {string} [options.method='POST'] - HTTP Method.
 * @param {Object} [options.headers={}] - HTTP Request Headers.
 * @param {string|Buffer|Object} [options.body=''] - Payload body to send.
 * @param {number} [options.timeout=5000] - Request timeout in ms.
 * @param {boolean} [options.rejectUnauthorized=true] - TLS cert enforcement flag.
 * @returns {Promise<Object>} Resolves with { statusCode, headers, body }
 */
function sendHttpRequest(options) {
  return new Promise((resolve, reject) => {
    const {
      targetUrl,
      method = 'POST',
      headers = {},
      body = '',
      timeout = 5000,
      rejectUnauthorized = true
    } = options;

    if (!targetUrl) {
      return reject(new Error('Target URL is required for sendHttpRequest'));
    }

    const parsedUrl = new URL(targetUrl);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const payload = typeof body === 'object' && !Buffer.isBuffer(body)
      ? JSON.stringify(body)
      : body;

    const reqHeaders = {
      ...headers
    };

    if (payload && !reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: reqHeaders,
      timeout: timeout,
      rejectUnauthorized: rejectUnauthorized
    };

    const req = transport.request(requestOptions, (res) => {
      let responseData = [];

      res.on('data', (chunk) => {
        responseData.push(chunk);
      });

      res.on('end', () => {
        const responseBuffer = Buffer.concat(responseData);
        let parsedBody = responseBuffer.toString('utf8');

        try {
          parsedBody = JSON.parse(parsedBody);
        } catch (e) {
          // Keep as string if not valid JSON
        }

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsedBody
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP Request timed out after ${timeout}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

module.exports = {
  createHttpServer: createHttpServer,
  createRequestHandler: createRequestHandler,
  proxyToProtocol: proxyToProtocol,
  sendHttpRequest: sendHttpRequest
};