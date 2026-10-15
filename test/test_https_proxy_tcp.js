const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const { helpers: { sendHttpRequest } } = require('../index');
const { createTcpServer } = require('../demo_https/server_tcp');
const { startProxyServer } = require('../demo_https/proxy_tcp');

const TARGET_PORT = 9001;
const PROXY_PORT = 41211;

describe('HTTP/S to TCP Reverse Proxy Integration Tests', () => {
  let tcpServerInstance;
  let proxyServerInstance;

  before((done) => {
    try {
      // 1. Programmatically start the TCP target server
      tcpServerInstance = createTcpServer(TARGET_PORT);
      
      // 2. Programmatically start the HTTP/S Proxy server on port 41211
      const proxyResult = startProxyServer();
      proxyServerInstance = proxyResult.server || proxyResult;

      // Allow a brief pause for both servers to fully bind to their ports
      setTimeout(done, 400);
    } catch (err) {
      done(err);
    }
  });

  after((done) => {
    // 3. Gracefully shut down both servers after tests complete
    let closedCount = 0;
    const checkDone = () => {
      closedCount++;
      if (closedCount === 2) done();
    };

    if (tcpServerInstance && typeof tcpServerInstance.close === 'function') {
      tcpServerInstance.close(checkDone);
    } else {
      checkDone();
    }

    if (proxyServerInstance && typeof proxyServerInstance.close === 'function') {
      proxyServerInstance.close(checkDone);
    } else {
      checkDone();
    }
  });

  it('should successfully proxy a GET request to the TCP server', async () => {
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/get-resource`,
      method: 'GET',
      headers: { 'x-client-name': 'get-client' },
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('GET');
    expect(body.url).to.equal('/get-resource');
  });

  it('should successfully proxy a POST request with payload to the TCP server', async () => {
    const payload = { action: 'create', data: { name: 'test item', value: 42 } };
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/post-resource`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-name': 'post-client' },
      body: JSON.stringify(payload),
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('POST');
    expect(body.url).to.equal('/post-resource');
  });

  it('should successfully proxy a PUT request with payload to the TCP server', async () => {
    const payload = { action: 'update', data: { id: 1, name: 'updated item', value: 100 } };
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/put-resource`,
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-client-name': 'put-client' },
      body: JSON.stringify(payload),
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('PUT');
    expect(body.url).to.equal('/put-resource');
  });

  it('should successfully proxy a PATCH request with payload to the TCP server', async () => {
    const payload = { data: { value: 75 } };
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/patch-resource`,
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-client-name': 'patch-client' },
      body: JSON.stringify(payload),
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('PATCH');
    expect(body.url).to.equal('/patch-resource');
  });

  it('should successfully proxy a DELETE request to the TCP server', async () => {
    const res = await sendHttpRequest({
      targetUrl: `https://127.0.0.1:${PROXY_PORT}/delete-resource`,
      method: 'DELETE',
      headers: { 'x-client-name': 'delete-client' },
      rejectUnauthorized: false
    });

    expect(res.statusCode).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.success).to.be.true;
    expect(body.method).to.equal('DELETE');
    expect(body.url).to.equal('/delete-resource');
  });
});