const assert = require('assert');
const http = require('http');
const { helpers: { sendHttpRequest } } = require('../index');
const { createTlsServer: startTlsServer } = require('../demo_https/server_tls');
const { proxyToProtocol } = require('../demo_https/proxy_tls');

const PROXY_PORT = 41211;
const TLS_PORT = 9002;

async function runTests() {
  console.log('[Test] Starting TLS Target Server...');
  const tlsServerInstance = startTlsServer();

  // Give servers a moment to initialize binding
  await new Promise((resolve) => setTimeout(resolve, 500));

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  try {
    for (const method of methods) {
      console.log(`[Test] Testing HTTP method: ${method}`);
      
      const payload = ['POST', 'PUT', 'PATCH'].includes(method) 
        ? JSON.stringify({ testKey: `testValue_${method}` }) 
        : '';

      const response = await sendHttpRequest({
        targetUrl: `https://127.0.0.1:${PROXY_PORT}/test-${method.toLowerCase()}`,
        method: method,
        headers: {
          'content-type': 'application/json',
          'x-test-method': method
        },
        body: payload,
        rejectUnauthorized: false
      });

      assert.strictEqual(response.statusCode, 200, `Failed status for ${method}`);
      
      const responseBody = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      assert.strictEqual(responseBody.success, true);
      assert.strictEqual(responseBody.method, method);
      console.log(`[Test] ✓ Method ${method} passed successfully.`);
    }

    console.log('\nAll HTTP -> TLS Proxy tests passed successfully!');
  } catch (err) {
    console.error('[Test] Test suite failed:', err);
    process.exitCode = 1;
  } finally {
    console.log('[Test] Cleaning up servers...');
    if (tlsServerInstance && typeof tlsServerInstance.close === 'function') {
      tlsServerInstance.close();
    }
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };