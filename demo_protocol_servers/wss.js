const { servers, getCerts } = require('../index');
const { wss: createWssServer } = servers;

/**
 * Starts a Secure WebSocket (WSS) server using createWssServer with custom handlers
 * for all lifecycle events (onConnect, onData, onClose, onEnd), and responds
 * by echoing back the received data.
 */
function startServer() {
    const port = process.env.PORT || 8443;
    const { key, cert } = getCerts();

    const options = {
        port: port,
        key: key,
        cert: cert,

        // Lifecycle event: onConnect (Triggered when a client successfully connects via WSS upgrade)
        onConnect: (socket, req) => {
            console.log(`[WSS Lifecycle] onConnect: Secure client connected from IP: ${req.socket.remoteAddress}`);

            // Additional socket error/timeout handling
            socket.on('error', (err) => {
                console.error('[WSS Event] error:', err.message);
            });

            socket.on('timeout', () => {
                console.warn('[WSS Event] timeout: Secure WebSocket timed out.');
                socket.end();
            });
        },

        // Lifecycle event: onData (Triggered when a framed text/binary message is received)
        onData: async (parsedData, socket) => {
            console.log('[WSS Lifecycle] onData: Received secure payload from client:', parsedData);

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
            console.log('[WSS Lifecycle] onEnd: Secure WebSocket connection ended by client.');
        },

        // Lifecycle event: onClose (Triggered when the socket is fully closed)
        onClose: (hadError, socket) => {
            console.log(`[WSS Lifecycle] onClose: Secure WebSocket closed. Had error: ${hadError}`);
        }
    };

    // Create and start the Secure WebSocket server
    const serverInstance = createWssServer(options);

    console.log(`WSS (Secure WebSocket) server initialized and listening on port ${port}`);
    return serverInstance;
}

module.exports = {
    startServer
};

// Start server if run directly
if (require.main === module) {
    startServer();
}