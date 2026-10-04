var http = require('http');
var net = require('net');

// Arrays to track active server and client instances
var activeServers = [];
var activeSockets = [];

/**
 * Utility helper to register a server instance for automatic cleanup.
 * @param {Object} server - HTTP/TCP server instance
 */
function trackServer(server) {
  activeServers.push(server);
  
  // Track open sockets on each server to ensure clean destruction
  if (!server.__trackedSockets) {
    server.__trackedSockets = new Set();
    server.on('connection', function (socket) {
      server.__trackedSockets.add(socket);
      socket.on('close', function () {
        server.__trackedSockets.delete(socket);
      });
    });
  }
  return server;
}

/**
 * Utility helper to register a client connection for automatic cleanup.
 * @param {Object} clientSocket - Net socket or HTTP client request
 */
function trackClient(clientSocket) {
  activeSockets.push(clientSocket);
  clientSocket.on('close', function () {
    var index = activeSockets.indexOf(clientSocket);
    if (index !== -1) {
      activeSockets.splice(index, 1);
    }
  });
  return clientSocket;
}

// Global Teardown Hook executed after all tests complete
after(function (done) {
  // 1. Arm the 60,000 ms fallback exit timer
  var fallbackTimeout = setTimeout(function () {
    console.warn('Process did not exit cleanly within 60000 ms. Forcing exit.');
    process.exit(0);
  }, 60000);

  // Unref the fallback timer so it does not prevent normal exit if everything closes cleanly
  if (fallbackTimeout.unref) {
    fallbackTimeout.unref();
  }

  var pendingClosures = 0;
  var totalServers = activeServers.length;

  // Helper to check when all graceful server closes are completed
  function checkComplete() {
    pendingClosures++;
    if (pendingClosures >= totalServers) {
      // Clear all tracked client sockets
      activeSockets.forEach(function (socket) {
        if (!socket.destroyed) {
          socket.destroy();
        }
      });
      activeSockets = [];
      done();
    }
  }

  // 2. Destroy active server-side client sockets and close servers
  if (activeServers.length === 0) {
    // Destroy lingering client connections if no servers were tracked
    activeSockets.forEach(function (socket) {
      if (!socket.destroyed) {
        socket.destroy();
      }
    });
    activeSockets = [];
    return done();
  }

  activeServers.forEach(function (server) {
    // Force close active connections attached to the server
    if (server.__trackedSockets) {
      server.__trackedSockets.forEach(function (socket) {
        if (!socket.destroyed) {
          socket.destroy();
        }
      });
      server.__trackedSockets.clear();
    }

    // Close the server instance
    server.close(function () {
      checkComplete();
    });
  });
});

module.exports = {
  trackServer: trackServer,
  trackClient: trackClient
};