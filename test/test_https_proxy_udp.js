const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const { helpers: { sendHttpRequest } } = require('../index');
const { createUdpServer } = require('../demo_https/server_udp');
const { startProxyServer } = require('../demo_https/proxy_udp');

const TARGET_PORT = 9003;
const PROXY_PORT = 41211;

describe('HTTP/S to UDP Reverse Proxy Integration Tests', () => {
  let udpServerInstance;
  let proxyServerInstance;

  before((done) => {
    try {
      // 1. Programmatically start the UDP target server
      udpServerInstance = createUdpServer(TARGET_PORT);
      
      // 2. Programmatically start the HTTPS Proxy server on port 41211
      const proxyResult = startProxyServer();
      proxyServerInstance = proxyResult.server || proxyResult;

      // Allow a brief pause for servers to initialize binding
      setTimeout(done, 500);
    } catch (err) {
      done(err);
    }
  });

  after((done) => {
    let closedCount = 0;
    const checkDone = () => {
      closedCount++;
      if (closedCount === 2) done();
    };

    if (udpServerInstance && typeof udpServerInstance.close === 'function') {
      udpServerInstance.close(checkDone);
    } else {
      checkDone();
    }

    if (proxyServerInstance && typeof proxyServerInstance.close === 'function') {
      proxyServerInstance.close(checkDone);
    } else {
      checkDone();
    }
  });

  it('should successfully proxy a GET request to the UDP target server', async () => {
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/udp-get`,
      method: 'GET',
      headers: { 'x-client-test': 'udp-get-client' },
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('GET');
    expect(body.url).to.equal('/udp-get');
  });

  it('should successfully proxy a POST request with payload to the UDP target server', async () => {
    const payload = { testKey: 'udpPostValue', count: 123 };
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/udp-post`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-test': 'udp-post-client' },
      body: JSON.stringify(payload),
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('POST');
    expect(body.url).to.equal('/udp-post');
  });

  it('should successfully proxy a PUT request with payload to the UDP target server', async () => {
    const payload = { testKey: 'udpPutValue', updated: true };
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/udp-put`,
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-client-test': 'udp-put-client' },
      body: JSON.stringify(payload),
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('PUT');
    expect(body.url).to.equal('/udp-put');
  });

  it('should successfully proxy a PATCH request with payload to the UDP target server', async () => {
    const payload = { patched: true };
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/udp-patch`,
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-client-test': 'udp-patch-client' },
      body: JSON.stringify(payload),
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('PATCH');
    expect(body.url).to.equal('/udp-patch');
  });

  it('should successfully proxy a DELETE request to the UDP target server', async () => {
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/udp-delete`,
      method: 'DELETE',
      headers: { 'x-client-test': 'udp-delete-client' },
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('DELETE');
    expect(body.url).to.equal('/udp-delete');
  });
});