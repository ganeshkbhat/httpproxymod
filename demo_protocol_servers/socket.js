const { servers } = require('../index');
const { socket: createSocketServer } = servers;
const path = require('path');
const os = require('os');

/**
 * Starts a UNIX/Named Pipe socket server using createSocketServer with custom handlers
 * for all lifecycle events (onConnect, onData, onClose, onEnd), and responds
 * by echoing back the received data.
 */
function startServer() {
    const socketPath = process.platform === 'win32'
        ? '\\.\pipe\demo_socket_target'
        : path.join(os.tmpdir(), 'demo_socket_target.sock');

    const options = {
        path: socketPath,

        // Lifecycle event: onConnect (Triggered when a client connects to the socket)
        onConnect: (socket) => {
            console.log('[Socket Lifecycle] onConnect: Client connected to UNIX/Named Pipe socket.');

            // Additional socket error/timeout handling
            socket.on('error', (err) => {
                console.error('[Socket Event] error:', err.message);
            });

            socket.on('timeout', () => {
                console.warn('[Socket Event] timeout: Socket timed out.');
                socket.end();
            });
        },

        // Lifecycle event: onData (Triggered when a framed message is successfully parsed and received)
        onData: async (parsedData, socket) => {
            console.log('[Socket Lifecycle] onData: Received payload from client:', parsedData);

            // Compute buffer details or response body
            const buffer = typeof parsedData === 'string'
                ? Buffer.from(parsedData, 'utf8')
                : Buffer.from(JSON.stringify(parsedData), 'utf8');

            const responsePayload = {
                status: 200,
                headers: { 'content-type': 'application/json' },
                body: {
                    receivedMessage: parsedData,
                    receivedHex: buffer.toString('hex'),
                    serverTime: new Date().toISOString()
                }
            };

            return responsePayload;
        },

        // Lifecycle event: onEnd (Triggered when the other end of the socket sends a FIN packet)
        onEnd: (socket) => {
            console.log('[Socket Lifecycle] onEnd: Client initiated socket termination (FIN received).');
        },

        // Lifecycle event: onClose (Triggered when the socket is fully closed)
        onClose: (hadError, socket) => {
            console.log('[Socket Lifecycle] onClose: Socket closed. Had error:', hadError);
        }
    };

    // Create and start the socket server
    const serverInstance = createSocketServer(options);

    console.log(`Socket server initialized and listening at path: ${socketPath}`);
    return serverInstance;
}

module.exports = {
    startServer
};

// Start server if run directly
if (require.main === module) {
    startServer();
}