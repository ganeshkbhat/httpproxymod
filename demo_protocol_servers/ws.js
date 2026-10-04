const { servers } = require('../index');
const { ws: createWsServer } = servers;

/**
 * Starts a WebSocket server using createWsServer with custom handlers
 * for all lifecycle events (onConnect, onData, onClose, onEnd), and responds
 * by echoing back the received data.
 */
function startServer() {
    const port = process.env.PORT || 8081;

    const options = {
        port: port,

        // Lifecycle event: onConnect (Triggered when a client successfully connects via WS upgrade)
        onConnect: (socket, req) => {
            console.log(`[WS Lifecycle] onConnect: Client connected from IP: ${req.socket.remoteAddress}`);

            // Additional socket error/timeout handling
            socket.on('error', (err) => {
                console.error('[WS Event] error:', err.message);
            });

            socket.on('timeout', () => {
                console.warn('[WS Event] timeout: WebSocket timed out.');
                socket.end();
            });
        },

        // Lifecycle event: onData (Triggered when a framed text/binary message is received)
        onData: async (parsedData, socket) => {
            console.log('[WS Lifecycle] onData: Received payload from client:', parsedData);

            // Construct response echoing the received data along with server metadata
            const responsePayload = {
                status: 200,
                receivedData: parsedData,
                serverTime: new Date().toISOString()
            };

            return responsePayload;
        },

        // Lifecycle event: onEnd (Triggered when client sends a close frame or ends the connection)
        onEnd: (socket) => {
            console.log('[WS Lifecycle] onEnd: WebSocket connection ended by client.');
        },

        // Lifecycle event: onClose (Triggered when the socket is fully closed)
        onClose: (hadError, socket) => {
            console.log(`[WS Lifecycle] onClose: WebSocket closed. Had error: ${hadError}`);
        }
    };

    // Create and start the WebSocket server
    const serverInstance = createWsServer(options);

    console.log(`WebSocket server initialized and listening on port ${port}`);
    return serverInstance;
}

module.exports = {
    startServer
};

// Start server if run directly
if (require.main === module) {
    startServer();
}