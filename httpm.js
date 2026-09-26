const http = require('http');
const https = require('https');
const { URL } = require('url');

// ============================================================================
// DEFAULT HANDLERS & STATE
// ============================================================================

let activeProtocolClient = null;

/**
 * Default Proxy Handler.
 * Executes a custom `options.requestHandler` function if provided,
 * otherwise responds with a hardcoded "hello world" response.
 *
 * @param {Object} req - Incoming HTTP request stream (`http.IncomingMessage`).
 * @param {Object} res - Outgoing HTTP response stream (`http.ServerResponse`).
 * @param {Object} httpRequestDetails - Parsed HTTP request object.
 * @param {string} httpRequestDetails.protocol - 'http' or 'https'.
 * @param {string} httpRequestDetails.url - Incoming request URL path and query string.
 * @param {string} httpRequestDetails.method - HTTP Method (GET, POST, etc.).
 * @param {Object} httpRequestDetails.headers - Incoming HTTP request headers.
 * @param {string} httpRequestDetails.body - Request payload stringified UTF-8 body.
 * @param {Object} [options={}] - Configuration options.
 * @param {Function} [options.requestHandler] - Custom request/response handling callback function.
 * @returns {Promise<any>}
 */
const defaultProxyHandler = async (req, res, httpRequestDetails, options = {}) => {
  if (typeof options.requestHandler === 'function') {
    return await options.requestHandler(req, res, httpRequestDetails, options);
  }

  res.send("hello world");
};

/**
 * HTTP/HTTPS Proxy Handler.
 * Executes a custom `options.requestHandler` function if provided,
 * otherwise proxies the request to the target HTTP/HTTPS host using `createHttpClient`.
 * Can be used directly as a request handler or invoked by `proxyToProtocol`.
 *
 * @param {Object} req - Incoming HTTP request stream (`http.IncomingMessage`).
 * @param {Object} res - Outgoing HTTP response stream (`http.ServerResponse`).
 * @param {Object} httpRequestDetails - Parsed HTTP request object.
 * @param {string} httpRequestDetails.protocol - 'http' or 'https'.
 * @param {string} httpRequestDetails.url - Incoming request URL path and query string.
 * @param {string} httpRequestDetails.method - HTTP Method (GET, POST, etc.).
 * @param {Object} httpRequestDetails.headers - Incoming HTTP request headers.
 * @param {string} httpRequestDetails.body - Request payload stringified UTF-8 body.
 * @param {Object} [options={}] - Configuration options.
 * @param {Function} [options.requestHandler] - Custom request/response handling callback function.
 * @param {string} [options.protocolHost='127.0.0.1'] - Target host IP or domain.
 * @param {number} [options.protocolPort] - Target port.
 * @param {number} [options.targetPort] - Fallback target port if `protocolPort` is omitted.
 * @param {boolean} [options.useHttps=false] - Whether target uses HTTPS scheme.
 * @param {string} [options.protocol='http'] - Target protocol ('http' or 'https').
 * @returns {Promise<Object>} Resolves with `{ status, headers, body }`
 */
const httpProxyHandler = async (req, res, httpRequestDetails, options = {}) => {
  if (typeof options.requestHandler === 'function') {
    const handlerResult = await options.requestHandler(req, res, httpRequestDetails, options);
    if (res && (res.writableEnded || res.finished)) {
      return handlerResult;
    }
  }

  const host = options.protocolHost || '127.0.0.1';
  const protocolType = (options.protocol || 'http').toLowerCase();
  const isHttps = Boolean(options.useHttps || protocolType === 'https');
  const defaultPort = isHttps ? 443 : 80;
  const port = options.protocolPort || options.targetPort || defaultPort;
  const scheme = isHttps ? 'https' : 'http';

  const details = httpRequestDetails || (req ? {
    url: req.url,
    method: req.method,
    headers: req.headers,
    body: ''
  } : {});

  const targetUrl = `${scheme}://${host}:${port}${details.url || '/'}`;
  const client = createHttpClient(options);

  try {
    const proxyRes = await client.sendHttpRequest({
      targetUrl: targetUrl,
      method: details.method || 'GET',
      headers: details.headers || {},
      body: details.body || ''
    });

    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      const responseBody = typeof proxyRes.body === 'object' && proxyRes.body !== null && !Buffer.isBuffer(proxyRes.body)
        ? JSON.stringify(proxyRes.body)
        : proxyRes.body;
      res.end(responseBody);
    }

    return {
      status: proxyRes.statusCode,
      headers: proxyRes.headers,
      body: proxyRes.body
    };
  } catch (err) {
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(504, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Gateway Timeout / Proxy Request Failed',
        details: err.message
      }));
    }
    throw err;
  }
};

// ============================================================================
// HTTP / HTTPS SERVER MODULE
// ============================================================================

/**
 * Standalone Protocol Proxy Handler.
 * Encapsulates creating/using the protocol client based on `options.createClient` or `options.protocol`.
 * For HTTP and HTTPS protocols, it delegates directly to `createHttpClient`.
 *
 * @param {Object} httpRequestDetails - Parsed request details.
 * @param {string} httpRequestDetails.protocol - Request protocol ('http' or 'https').
 * @param {string} httpRequestDetails.url - Request URL path.
 * @param {string} httpRequestDetails.method - HTTP method (e.g. 'POST').
 * @param {Object} httpRequestDetails.headers - Key-value pair of request headers.
 * @param {string} httpRequestDetails.body - Request payload body string.
 * @param {Object} [options={}] - Options object.
 * @param {Object} [options.protocolClient] - Pre-instantiated protocol client instance containing `sendHttpRequestPayload`.
 * @param {string} [options.protocol='http'] - Target protocol type ('http', 'https', 'tcp', 'socket', 'udp', 'websocket', 'ws', 'wss').
 * @param {Function} [options.createClient] - Custom client factory function `(clientConfig) => client`.
 * @param {string} [options.protocolHost='127.0.0.1'] - Destination target host IP or hostname.
 * @param {number} [options.protocolPort] - Target port for the downstream protocol connection.
 * @param {Object} [options.protocolCredentials] - Authentication credentials object passed to downstream protocol clients.
 * @param {boolean} [options.useHttps=false] - If true, forces target protocol scheme to 'https'.
 * @returns {Promise<Object>} Resolves with `{ protocolClient, response: { status, headers, body } }`
 */
async function proxyToProtocol(httpRequestDetails, options = {}) {
  let protocolClient;

  if (options.protocolClient) {
    protocolClient = options.protocolClient;
  } else {
    const protocolType = (options.protocol || 'http').toLowerCase();
    const host = options.protocolHost || '127.0.0.1';
    const port = options.protocolPort;
    const credentials = options.protocolCredentials;

    if (typeof options.createClient === 'function') {
      protocolClient = options.createClient({ host, port, credentials });
    } else {
      switch (protocolType) {
        case 'tcp':
        case 'socket': {
          const { createTcpClient } = require('../proxies/http2tcpproxy/htcp');
          protocolClient = createTcpClient({ host, port, credentials });
          break;
        }
        case 'udp': {
          const { createUdpClient } = require('../proxies/http2udpproxy/hudp');
          protocolClient = createUdpClient({ host, port, credentials });
          break;
        }
        case 'websocket':
        case 'ws':
        case 'wss': {
          const { createWsClient } = require('./wsm');
          protocolClient = createWsClient({
            host,
            port,
            credentials,
            useSsl: protocolType === 'wss'
          });
          break;
        }
        case 'http':
        case 'https': {
          protocolClient = createHttpClient(options);
          break;
        }
        default:
          throw new Error(`Unsupported protocol type: ${options.protocol}`);
      }
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
 * Decouples web server protocol handling from the underlying proxy implementation.
 *
 * @param {Object} [options={}] - Options object.
 * @param {Function|any} [options.authenticate] - Authentication hook `(httpRequestDetails) => boolean|Promise<boolean>`.
 * @param {boolean} [options.useHttps=false] - Sets request protocol to 'https' if true.
 * @param {string|Buffer} [options.key] - TLS private key.
 * @param {string|Buffer} [options.cert] - TLS certificate.
 * @param {string} [options.protocol] - Target protocol. If omitted, `defaultProxyHandler` is used.
 * @param {Function} [setProtocolClient] - Callback to register the active protocol client instance `(client) => void`.
 * @param {Function} [proxyHandler] - Custom proxy execution function. Defaults to `defaultProxyHandler` if protocol is not specified.
 * @returns {Function} Standard Node.js `(req, res)` HTTP request listener.
 */
function createRequestHandler(options = {}, setProtocolClient = (client) => {
    activeProtocolClient = client;
  }, proxyHandler) {
  const authenticate = options.authenticate !== undefined
    ? options.authenticate
    : ((httpRequestDetails) => true);

  const protocol = options.useHttps || (options.key && options.cert) ? 'https' : 'http';
  
  // If protocol is not specified, defaultProxyHandler is the default function
  const handler = proxyHandler || (options.protocol ? proxyToProtocol : defaultProxyHandler);

  return (req, res) => {
    if (typeof res.send !== 'function') {
      res.send = (data) => {
        if (!res.headersSent) {
          if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
            res.writeHead(200, { 'content-type': 'application/json' });
            data = JSON.stringify(data);
          } else {
            res.writeHead(200, { 'content-type': 'text/plain' });
          }
        }
        res.end(data);
      };
    }

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
      if (typeof authenticate !== 'function') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          error: 'Unauthorized: Authentication handler is not a function'
        }));
      }

      const isAllowed = await authenticate(httpRequestDetails);
      if (!isAllowed) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          error: 'Unauthorized: HTTP Server custom authentication failed'
        }));
      }

      // Step 2: Delegate to proxy handler
      let proxyResult;
      if (handler === proxyToProtocol) {
        proxyResult = await handler(httpRequestDetails, options);
      } else {
        proxyResult = await handler(req, res, httpRequestDetails, options);
      }

      if (res.writableEnded || res.finished) {
        return;
      }

      if (proxyResult && proxyResult.protocolClient) {
        setProtocolClient(proxyResult.protocolResult || proxyResult.protocolClient);
      }

      // Step 3: Dispatch final response stream back to HTTP Client if not already sent
      const response = proxyResult && proxyResult.response
        ? proxyResult.response
        : { status: 500, headers: {}, body: 'Internal Server Error' };

      let responseBody = response.body;
      if (typeof responseBody === 'object' && responseBody !== null && !Buffer.isBuffer(responseBody)) {
        responseBody = JSON.stringify(responseBody);
      }

      res.writeHead(response.status, response.headers);
      res.end(responseBody);
    });
  };
}

/**
 * Creates and starts an HTTP or HTTPS Server.
 * If `options.protocol` is not specified, `defaultProxyHandler` is used by default to manage requests.
 *
 * @param {Object} [options={}] - Options configuration object.
 * @param {number} [options.port=8080] - Server port to listen on.
 * @param {number} [options.httpPort] - Alternate server port option taking precedence over `options.port`.
 * @param {boolean} [options.useHttps=false] - Whether to instantiate an HTTPS server.
 * @param {string|Buffer} [options.key] - Private key for HTTPS.
 * @param {string|Buffer} [options.cert] - Cert chain for HTTPS.
 * @param {string|Buffer|Array} [options.ca] - CA cert authority overrides.
 * @param {string|Buffer} [options.pfx] - PFX file content.
 * @param {string} [options.passphrase] - Passphrase for private key or PFX.
 * @param {Function|any} [options.authenticate] - Authentication hook function.
 * @param {Function} [options.requestHandler] - Custom handler executed within `defaultProxyHandler` / `httpProxyHandler`.
 * @param {Object} [options.protocolClient] - Pre-existing protocol client instance.
 * @param {string} [options.protocol] - Target forwarding protocol type.
 * @param {string} [options.protocolHost='127.0.0.1'] - Downstream host IP/Domain.
 * @param {number} [options.protocolPort] - Downstream port.
 * @param {Object} [options.protocolCredentials] - Downstream credentials object.
 * @param {Function} [proxyHandler] - Custom handler responsible for request execution.
 * @returns {Object} `{ server: http.Server|https.Server, getProtocolClient: Function }`
 */
function createHttpServer(options = {}, proxyHandler) {
  const port = options.httpPort || options.port || 8080;
  const isHttps = Boolean(options.useHttps || (options.key && options.cert));

  let localActiveProtocolClient = options.protocolClient || null;

  const requestHandler = createRequestHandler(options, (client) => {
    localActiveProtocolClient = client;
    activeProtocolClient = client;
  }, proxyHandler);

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
    getProtocolClient: () => localActiveProtocolClient
  };
}

// ============================================================================
// HTTP / HTTPS CLIENT MODULE
// ============================================================================

/**
 * Creates an HTTP/HTTPS Client instance with `sendHttpRequest` and `sendHttpRequestPayload`.
 *
 * @param {Object} [clientOptions={}] - Default options for the HTTP client instance.
 * @returns {Object} Client instance object `{ sendHttpRequest: Function, sendHttpRequestPayload: Function }`
 */
function createHttpClient(clientOptions = {}) {
  const sendHttpRequest = (options = {}) => {
    return new Promise((resolve, reject) => {
      const mergedOptions = {
        timeout: 5000,
        rejectUnauthorized: true,
        ...clientOptions,
        ...options,
        headers: {
          ...(clientOptions.headers || {}),
          ...(options.headers || {})
        }
      };

      const {
        targetUrl,
        method = 'POST',
        headers = {},
        body = '',
        timeout = 5000,
        rejectUnauthorized = true
      } = mergedOptions;

      if (!targetUrl) {
        return reject(new Error('Target URL is required for sendHttpRequest'));
      }

      const parsedUrl = new URL(targetUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const payload = typeof body === 'object' && body !== null && !Buffer.isBuffer(body)
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
        req.destroy(new Error(`HTTP Request timed out after ${timeout}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (payload) {
        req.write(payload);
      }

      req.end();
    });
  };

  const sendHttpRequestPayload = async (details = {}) => {
    const isHttps = Boolean(clientOptions.useHttps || (clientOptions.protocol || '').toLowerCase() === 'https');
    const defaultPort = isHttps ? 443 : 80;
    const host = clientOptions.protocolHost || '127.0.0.1';
    const port = clientOptions.protocolPort || clientOptions.targetPort || defaultPort;
    const scheme = isHttps ? 'https' : 'http';
    const targetUrl = details.targetUrl || `${scheme}://${host}:${port}${details.url || '/'}`;

    const res = await sendHttpRequest({
      targetUrl: targetUrl,
      method: details.method || 'GET',
      headers: details.headers || {},
      body: details.body || ''
    });

    return {
      status: res.statusCode,
      headers: res.headers,
      body: res.body
    };
  };

  return {
    sendHttpRequest: sendHttpRequest,
    sendHttpRequestPayload: sendHttpRequestPayload
  };
}

/**
 * Helper function to make direct HTTP requests using createHttpClient.
 *
 * @param {Object} options - Request options.
 * @returns {Promise<Object>}
 */
function sendHttpRequest(options) {
  return createHttpClient().sendHttpRequest(options);
}

module.exports = {
  createHttpServer: createHttpServer,
  createHttpClient: createHttpClient,
  createRequestHandler: createRequestHandler,
  proxyToProtocol: proxyToProtocol,
  defaultProxyHandler: defaultProxyHandler,
  httpProxyHandler: httpProxyHandler,
  sendHttpRequest: sendHttpRequest
};