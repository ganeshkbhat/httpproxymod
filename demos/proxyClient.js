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