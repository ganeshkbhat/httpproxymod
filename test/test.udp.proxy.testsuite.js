const { servers, clients, getCerts, createUdpProxyServer, DEFAULT_SOCKET_PATH } = require('../index.js');
const { expect } = require('chai');
const http = require('http');
const https = require('https');

describe('UDP Proxy Protocol Integration Test Suite', function () {
  let certs;
  
  // Servers and clients tracking for cleanup
  let udpBackend, udpUdpProxy, udpUdpClient;
  let httpBackend, udpHttpProxy, udpHttpClient;
  let httpsBackend, udpHttpsProxy, udpHttpsClient;
  let tcpBackend, udpTcpProxy, udpTcpClient;
  let tlsBackend, udpTlsProxy, udpTlsClient;
  let socketBackend, udpSocketProxy, udpSocketClient;
  let wsBackend, udpWsProxy, udpWsClient;
  let wssBackend, udpWssProxy, udpWssClient;

  before(function () {
    certs = getCerts();
  });

  after(function () {
    try { if (udpBackend) udpBackend.close(); } catch (_) {}
    try { if (udpUdpProxy) udpUdpProxy.close(); } catch (_) {}
    try { if (udpUdpClient) udpUdpClient.close(); } catch (_) {}

    try { if (httpBackend) httpBackend.close(); } catch (_) {}
    try { if (udpHttpProxy) udpHttpProxy.close(); } catch (_) {}
    try { if (udpHttpClient) udpHttpClient.close(); } catch (_) {}

    try { if (httpsBackend) httpsBackend.close(); } catch (_) {}
    try { if (udpHttpsProxy) udpHttpsProxy.close(); } catch (_) {}
    try { if (udpHttpsClient) udpHttpsClient.close(); } catch (_) {}

    try { if (tcpBackend) tcpBackend.close(); } catch (_) {}
    try { if (udpTcpProxy) udpTcpProxy.close(); } catch (_) {}
    try { if (udpTcpClient) udpTcpClient.close(); } catch (_) {}

    try { if (tlsBackend) tlsBackend.close(); } catch (_) {}
    try { if (udpTlsProxy) udpTlsProxy.close(); } catch (_) {}
    try { if (udpTlsClient) udpTlsClient.close(); } catch (_) {}

    try { if (socketBackend) socketBackend.close(); } catch (_) {}
    try { if (udpSocketProxy) udpSocketProxy.close(); } catch (_) {}
    try { if (udpSocketClient) udpSocketClient.close(); } catch (_) {}

    try { if (wsBackend) wsBackend.close(); } catch (_) {}
    try { if (udpWsProxy) udpWsProxy.close(); } catch (_) {}
    try { if (udpWsClient) udpWsClient.close(); } catch (_) {}

    try { if (wssBackend) wssBackend.close(); } catch (_) {}
    try { if (udpWssProxy) udpWssProxy.close(); } catch (_) {}
    try { if (udpWssClient) udpWssClient.close(); } catch (_) {}
  });

  it('should proxy UDP to UDP protocol successfully', async function () {
    udpBackend = servers.udp({ port: 9080 }, async (msg, rinfo, server) => {
      const payload = JSON.parse(msg.toString('utf-8'));
      const resPayload = {
        correlationId: payload.correlationId,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { protocol: 'UDP', echoed: payload }
      };
      server.send(Buffer.from(JSON.stringify(resPayload)), rinfo.port, rinfo.address);
    });

    udpUdpProxy = createUdpProxyServer({
      udpPort: 41230,
      protocol: 'udp',
      protocolPort: 9080
    });
    udpUdpClient = clients.udp({ port: 41230 });

    const res = await udpUdpClient.sendHttpRequestPayload({ url: '/test-udp', method: 'GET', headers: {}, body: 'hello udp' });
    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.protocol).to.equal('UDP');
    expect(body.echoed.body).to.equal('hello udp');
  });

  it('should proxy UDP to HTTP protocol successfully', async function () {
    httpBackend = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          protocol: 'HTTP',
          echoed: { url: req.url, method: req.method, headers: req.headers, body }
        }));
      });
    });
    httpBackend.listen(9081);

    udpHttpProxy = createUdpProxyServer({
      udpPort: 41231,
      protocol: 'http',
      protocolPort: 9081
    });
    udpHttpClient = clients.udp({ port: 41231 });

    const res = await udpHttpClient.sendHttpRequestPayload({ url: '/test-http', method: 'GET', headers: {}, body: 'hello http' });
    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.protocol).to.equal('HTTP');
    expect(body.echoed.body).to.equal('hello http');
  });

  it('should proxy UDP to HTTPS protocol successfully', async function () {
    httpsBackend = https.createServer({ key: certs.key, cert: certs.cert }, (req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          protocol: 'HTTPS',
          echoed: { url: req.url, method: req.method, headers: req.headers, body }
        }));
      });
    });
    httpsBackend.listen(9082);

    udpHttpsProxy = createUdpProxyServer({
      udpPort: 41232,
      protocol: 'https',
      protocolPort: 9082,
      rejectUnauthorized: false
    });
    udpHttpsClient = clients.udp({ port: 41232 });

    const res = await udpHttpsClient.sendHttpRequestPayload({ url: '/test-https', method: 'POST', headers: {}, body: 'hello https' });
    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.protocol).to.equal('HTTPS');
    expect(body.echoed.body).to.equal('hello https');
  });

  it('should proxy UDP to TCP protocol successfully', async function () {
    tcpBackend = servers.tcp({ port: 9083 }, async (payload) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { protocol: 'TCP', echoed: payload }
    }));
    udpTcpProxy = createUdpProxyServer({
      udpPort: 41233,
      protocol: 'tcp',
      protocolPort: 9083
    });
    udpTcpClient = clients.udp({ port: 41233 });

    const res = await udpTcpClient.sendHttpRequestPayload({ url: '/test-tcp', method: 'GET', headers: {}, body: 'hello tcp' });
    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.protocol).to.equal('TCP');
    expect(body.echoed.body).to.equal('hello tcp');
  });

  it('should proxy UDP to TLS protocol successfully', async function () {
    tlsBackend = servers.tls({ port: 9084, key: certs.key, cert: certs.cert }, async (payload) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { protocol: 'TLS', echoed: payload }
    }));
    udpTlsProxy = createUdpProxyServer({
      udpPort: 41234,
      protocol: 'tls',
      protocolPort: 9084,
      key: certs.key,
      cert: certs.cert,
      rejectUnauthorized: false
    });
    udpTlsClient = clients.udp({ port: 41234 });

    const res = await udpTlsClient.sendHttpRequestPayload({ url: '/test-tls', method: 'GET', headers: {}, body: 'hello tls' });
    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.protocol).to.equal('TLS');
    expect(body.echoed.body).to.equal('hello tls');
  });

  it('should proxy UDP to Socket (Unix / Named Pipe) protocol successfully', async function () {
    socketBackend = servers.socket({ path: DEFAULT_SOCKET_PATH }, async (payload) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { protocol: 'SOCKET', echoed: payload }
    }));
    udpSocketProxy = createUdpProxyServer({
      udpPort: 41235,
      protocol: 'socket',
      socketPath: DEFAULT_SOCKET_PATH
    });
    udpSocketClient = clients.udp({ port: 41235 });

    const res = await udpSocketClient.sendHttpRequestPayload({ url: '/test-socket', method: 'GET', headers: {}, body: 'hello socket' });
    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.protocol).to.equal('SOCKET');
    expect(body.echoed.body).to.equal('hello socket');
  });

  it('should proxy UDP to WebSocket (WS) protocol successfully', async function () {
    wsBackend = servers.ws({ port: 9086 }, async (payload) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { protocol: 'WS', echoed: payload }
    }));
    udpWsProxy = createUdpProxyServer({
      udpPort: 41236,
      protocol: 'ws',
      protocolPort: 9086
    });
    udpWsClient = clients.udp({ port: 41236 });

    const res = await udpWsClient.sendHttpRequestPayload({ url: '/test-ws', method: 'GET', headers: {}, body: 'hello ws' });
    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.protocol).to.equal('WS');
    expect(body.echoed.body).to.equal('hello ws');
  });

  it('should proxy UDP to Secure WebSocket (WSS) protocol successfully', async function () {
    wssBackend = servers.wss({ port: 9087, key: certs.key, cert: certs.cert }, async (payload) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { protocol: 'WSS', echoed: payload }
    }));
    udpWssProxy = createUdpProxyServer({
      udpPort: 41237,
      protocol: 'wss',
      protocolPort: 9087,
      key: certs.key,
      cert: certs.cert,
      rejectUnauthorized: false
    });
    udpWssClient = clients.udp({ port: 41237 });

    const res = await udpWssClient.sendHttpRequestPayload({ url: '/test-wss', method: 'GET', headers: {}, body: 'hello wss' });
    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.protocol).to.equal('WSS');
    expect(body.echoed.body).to.equal('hello wss');
  });
});