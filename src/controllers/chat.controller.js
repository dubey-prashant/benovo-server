const ChatMessage = require('../models/chat.model');
const Campaign = require('../models/campaign.model');
const CampaignMember = require('../models/campaignMember.model');

/**
 * Send a new chat message
 * @route POST /api/chat/:campaignId
 * @access Private
 */
exports.sendMessage = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.userId;
    const { text } = req.body;

    // Verify user is a member of the campaign
    const membership = await CampaignMember.findOne({
      campaign_id: campaignId,
      user_id: userId,
    });

    if (!membership) {
      return res.status(403).json({
        message: 'You must be a member of this campaign to send messages',
      });
    }

    // Create the message
    const message = new ChatMessage({
      campaign_id: campaignId,
      user_id: userId,
      text,
      read_by: [{ user_id: userId }], // Mark as read by sender
    });

    await message.save();

    // Populate user info for the response
    const populatedMessage = await ChatMessage.findById(message._id)
      .populate('user_id', 'name email profile_image')
      .lean();

    const finalMessage = {
      ...populatedMessage,
      user: populatedMessage.user_id,
      user_id: populatedMessage.user_id._id,
    };

    // Emit the message via Socket.io
    const io = req.app.get('io');
    io.to(`campaign-${campaignId}`).emit('newMessage', finalMessage);

    res.status(201).json(finalMessage);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      message: 'Failed to send message',
      error: error.message,
    });
  }
};

/**
 * Get chat messages for a campaign
 * @route GET /api/chat/:campaignId
 * @access Private
 */
exports.getMessages = async (req, res) => {
  try {
    const { campaignId } = req.params;
    const userId = req.userId;
    const { limit = 50, before } = req.query;

    // Verify user is a member of the campaign
    const membership = await CampaignMember.findOne({
      campaign_id: campaignId,
      user_id: userId,
    });

    if (!membership) {
      return res.status(403).json({
        message: 'You must be a member of this campaign to view messages',
      });
    }

    // Build query
    let query = { campaign_id: campaignId };
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }

    // Get messages with pagination
    const messages = await ChatMessage.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      // .populate('user_id', 'name email profile_image')
      .lean();

    // Mark messages as read by this user
    const messageIds = messages.map((m) => m._id);
    if (messageIds.length > 0) {
      await ChatMessage.updateMany(
        {
          _id: { $in: messageIds },
          'read_by.user_id': { $ne: userId },
        },
        {
          $addToSet: { read_by: { user_id: userId } },
        }
      );
    }

    // Return messages in chronological order
    res.status(200).json(messages.reverse());
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      message: 'Failed to fetch messages',
      error: error.message,
    });
  }
};
