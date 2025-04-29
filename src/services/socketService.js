const socketIo = require('socket.io');
const Invitation = require('../models/invitation.model');
const User = require('../models/user.model');
const Campaign = require('../models/campaign.model');
const Notification = require('../models/notification.model'); // Assuming you have a notification model

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

    // Join a campaign room with new format
    socket.on('join-campaign', (campaignId) => {
      socket.join(`campaign:${campaignId}`);
      console.log(`User ${socket.userId} joined campaign room: ${campaignId}`);
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

    // Notification for new invitation
    socket.on('send-invitation', async (data) => {
      try {
        // Validate input
        if (!data || !data.toUserEmail || !data.campaignId || !socket.userId) {
          console.error('Invalid invitation data', data);
          socket.emit('invitation-error', {
            message: 'Invalid invitation data',
          });
          return;
        }

        // Find the recipient user
        const recipient = await User.findOne({
          email: data.toUserEmail.toLowerCase(),
        });
        if (!recipient) {
          socket.emit('invitation-error', { message: 'User not found' });
          return;
        }

        // Find the campaign
        const campaign = await Campaign.findById(data.campaignId);
        if (!campaign) {
          socket.emit('invitation-error', { message: 'Campaign not found' });
          return;
        }

        // Check if invitation already exists
        const existingInvitation = await Invitation.findOne({
          campaign_id: data.campaignId,
          email: data.toUserEmail.toLowerCase(),
          status: 'pending',
        });

        if (existingInvitation) {
          socket.emit('invitation-error', {
            message: 'Invitation already sent',
          });
          return;
        }

        // Create invitation in database
        const invitation = new Invitation({
          campaign_id: data.campaignId,
          email: data.toUserEmail.toLowerCase(),
          invited_by: socket.userId,
          status: 'pending',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        });

        await invitation.save();

        // Create notification for the recipient
        if (recipient) {
          const notification = new Notification({
            user_id: recipient._id,
            type: 'invitation',
            title: 'New Campaign Invitation',
            message: `You've been invited to join ${campaign.name}`,
            data: {
              invitationId: invitation._id,
              campaignId: data.campaignId,
              campaignName: campaign.name,
              fromUserId: socket.userId,
            },
            read: false,
          });

          await notification.save();

          // Send real-time notification if recipient is online
          const recipientSocketId = connectedUsers.get(
            recipient._id.toString()
          );
          if (recipientSocketId) {
            io.to(recipientSocketId).emit('invitation-received', {
              invitationId: invitation._id,
              campaignId: data.campaignId,
              campaignName: campaign.name,
              fromUserId: socket.userId,
              fromUserName: data.fromUserName || 'A campaign admin',
            });
          }
        }

        // Notify sender of success
        socket.emit('invitation-sent', {
          invitationId: invitation._id,
          email: data.toUserEmail,
          campaignId: data.campaignId,
        });

        // Notify all admins in the campaign room about the new invitation
        io.to(`campaign-${data.campaignId}`).emit('campaign-updated', {
          type: 'new-invitation',
          campaignId: data.campaignId,
          invitation: {
            id: invitation._id,
            email: data.toUserEmail,
            status: 'pending',
            created_at: invitation.createdAt,
          },
        });
      } catch (error) {
        console.error('Error processing invitation:', error);
        socket.emit('invitation-error', {
          message: 'Failed to process invitation',
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

// // When a new contribution is recorded
// // Add this to your recordContribution function
// if (io) {
//   io.to(`campaign:${campaignId}`).emit('new-contribution', {
//     contribution: populatedContribution,
//     message: `${contributorName} made a payment of ${formatCurrency(
//       amount
//     )} to ${recipientName}`,
//   });
// }

module.exports = { initializeSocket };
