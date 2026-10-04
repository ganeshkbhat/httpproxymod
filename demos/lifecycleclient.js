const { sendHttpRequest } = require('../index');

async function monitorRequestLifecycle() {
  try {
    const response = await sendHttpRequest({
      targetUrl: 'http://127.0.0.1:8080/api/stream-test',
      method: 'POST',
      body: JSON.stringify({ message: 'ping' }),
      
      onConnection: (socket) => {
        console.log(`[Socket Connected] Remote Address: ${socket.remoteAddress}:${socket.remotePort}`);
      },
      onData: (chunk) => {
        console.log(`[Chunk Received] Size: ${chunk.length} bytes`);
      },
      onEnd: () => {
        console.log('[Stream Ended] All data received.');
      },
      onError: (err) => {
        console.error('[Stream Error]', err.message);
      },
      onClose: () => {
        console.log('[Connection Closed] Response stream socket closed.');
      },
      onDestroy: () => {
        console.log('[Request Destroyed] Request cleanup complete.');
      }
    });

    console.log('Final Result:', response.body);
  } catch (err) {
    console.error('Execution Failed:', err.message);
  }
}

monitorRequestLifecycle();