const socketIo = require('socket.io');

function initializeSocket(server) {
  const io = socketIo(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Track connected users
  const connectedUsers = new Map();

  io.on('connection', (socket) => {
    console.log('New client connected', socket.id);

    // User authentication
    socket.on('authenticate', (userData) => {
      if (userData && userData.userId) {
        connectedUsers.set(userData.userId, socket.id);
        socket.userId = userData.userId;
        console.log('User authenticated:', userData.userId);

        // Join rooms for all user's campaigns
        if (userData.campaigns && Array.isArray(userData.campaigns)) {
          userData.campaigns.forEach((campaignId) => {
            socket.join(`campaign-${campaignId}`);
          });
        }
      }
    });

    // Join a campaign room
    socket.on('join-campaign', (campaignId) => {
      if (campaignId) {
        socket.join(`campaign-${campaignId}`);
        console.log(`User ${socket.userId} joined campaign ${campaignId}`);
      }
    });

    // Send message in campaign chat
    socket.on('campaign-message', (data) => {
      if (data && data.campaignId && data.message) {
        // Broadcast message to all members in the campaign room
        io.to(`campaign-${data.campaignId}`).emit('campaign-message', {
          userId: socket.userId,
          message: data.message,
          timestamp: new Date(),
        });
      }
    });

    // Disconnect
    socket.on('disconnect', () => {
      if (socket.userId) {
        connectedUsers.delete(socket.userId);
      }
      console.log('Client disconnected', socket.id);
    });
  });

  return io;
}

module.exports = { initializeSocket };
