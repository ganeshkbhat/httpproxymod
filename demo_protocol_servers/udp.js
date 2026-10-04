const { servers } = require('../index');
// Or if createUdpServer is exported directly or under servers.udp:
// Looking at index_11.js, servers.udp is createUdpServer. Let's check:
// Actually let's check exports of index_11.js. In index_11.js, servers.udp = createUdpServer.
// Let's create `server_target_udp.js` using complete and exact names as requested.

const { servers } = require('../index');
const { udp: createUdpServer } = servers;

/**
 * Starts a UDP server using createUdpServer from index_11.js with custom handlers
 * for all lifecycle events (onConnect, onData, onClose, onEnd), and responds
 * with the received data.
 */
function startServer() {
    const options = {
        host: '127.0.0.1',
        port: process.env.PORT || 41234,

        // Lifecycle event: onConnect (Triggered when the UDP socket starts listening)
        onConnect: (server) => {
            const address = server.address();
            console.log('[UDP Lifecycle] onConnect: UDP server is listening on %s:%d', address.address, address.port);

            // Additional native socket event listeners
            server.on('error', (err) => {
                console.error('[UDP Socket Event] error:', err.message);
            });

            server.on('connect', () => {
                console.log('[UDP Socket Event] connect: Socket connected event fired.');
            });
        },

        // Lifecycle event: onData (Triggered when a message is received from a client)
        onData: async (parsedData, rinfo, server) => {
            console.log('[UDP Lifecycle] onData: Received message from %s:%d', rinfo.address, rinfo.port);
            console.log('[UDP Data Payload]:', parsedData);

            const buffer = typeof parsedData === 'string' 
                ? Buffer.from(parsedData, 'utf8') 
                : Buffer.from(JSON.stringify(parsedData), 'utf8');

            const responsePayload = {
                status: 200,
                headers: { 'content-type': 'application/json' },
                body: {
                    receivedMessage: parsedData,
                    receivedHex: buffer.toString('hex'),
                    clientAddress: rinfo.address,
                    clientPort: rinfo.port,
                    timestamp: new Date().toISOString()
                }
            };

            return responsePayload;
        },

        // Lifecycle event: onClose (Triggered when the UDP socket is closed)
        onClose: (server) => {
            console.log('[UDP Lifecycle] onClose: UDP socket closed successfully.');
        },

        // Lifecycle event: onEnd (Triggered when closing via close wrapper)
        onEnd: (server) => {
            console.log('[UDP Lifecycle] onEnd: UDP server close sequence initiated.');
        }
    };

    // Create the UDP server using createUdpServer
    const udpServerInstance = createUdpServer(options);

    console.log(`UDP server initialized and bound on port ${options.port}`);
    return udpServerInstance;
}

module.exports = {
    startServer
};

// Start server if run directly
if (require.main === module) {
    startServer();
}