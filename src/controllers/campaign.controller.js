const Campaign = require('../models/campaign.model');
const CampaignMember = require('../models/campaignMember.model');
const User = require('../models/user.model');
const Invitation = require('../models/invitation.model');

exports.createCampaign = async (req, res) => {
  try {
    const {
      name,
      description,
      target_amount,
      contribution_amount,
      start_date,
      end_date,
      frequency,
      max_members,
    } = req.body;

    const userId = req.userId;

    // Create campaign
    const campaign = new Campaign({
      name,
      description,
      target_amount,
      contribution_amount,
      start_date: new Date(start_date),
      end_date: new Date(end_date),
      frequency,
      max_members,
      created_by: userId,
      status: 'active',
    });

    await campaign.save();

    // Add creator as member and admin
    const member = new CampaignMember({
      campaign_id: campaign._id,
      user_id: userId,
      is_admin: true,
    });

    await member.save();

    res.status(201).json({
      message: 'Campaign created successfully',
      campaign,
    });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({
      message: 'Failed to create campaign',
      error: error.message,
    });
  }
};

exports.getUserCampaigns = async (req, res) => {
  try {
    const userId = req.userId;

    // Find all campaign memberships for the user
    const memberships = await CampaignMember.find({ user_id: userId });

    // Get campaign IDs
    const campaignIds = memberships.map((m) => m.campaign_id);

    // Fetch campaigns with member count
    const campaigns = await Campaign.find({ _id: { $in: campaignIds } });

    // Get member counts for each campaign
    const campaignsWithMembers = await Promise.all(
      campaigns.map(async (campaign) => {
        const memberCount = await CampaignMember.countDocuments({
          campaign_id: campaign._id,
        });
        const membership = memberships.find(
          (m) => m.campaign_id.toString() === campaign._id.toString()
        );

        return {
          ...campaign.toObject(),
          members: memberCount,
          is_admin: membership.is_admin,
        };
      })
    );

    res.status(200).json(campaignsWithMembers);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to fetch campaigns',
      error: error.message,
    });
  }
};

exports.getCampaignById = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.userId;
    console.log('req.params', req.params);
    console.log('campaignId', campaignId);
    // Check if user is a member of the campaign
    const membership = await CampaignMember.findOne({
      campaign_id: campaignId,
      user_id: userId,
    });

    if (!membership) {
      return res
        .status(403)
        .json({ message: 'Not authorized to access this campaign' });
    }

    // Get campaign with member count
    const campaign = await Campaign.findById(campaignId);

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    const memberCount = await CampaignMember.countDocuments({
      campaign_id: campaignId,
    });

    // Get all members
    const membersData = await CampaignMember.find({
      campaign_id: campaignId,
    }).populate('user_id');

    // Map over members to format the data structure
    const members = membersData.map((member) => ({
      ...member.toObject(),
      user: member.user_id,
      user_id: member.user_id._id,
    }));

    res.status(200).json({
      ...campaign.toObject(),
      members,
      memberCount,
      is_admin: membership.is_admin,
    });
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({
      message: 'Failed to fetch campaign',
      error: error.message,
    });
  }
};

// Enhanced inviteMember function
exports.inviteMember = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.userId;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Check if user is an admin of the campaign
    const membership = await CampaignMember.findOne({
      campaign_id: campaignId,
      user_id: userId,
      is_admin: true,
    });

    if (!membership) {
      return res
        .status(403)
        .json({ message: 'Not authorized to invite members' });
    }

    // Get campaign to check member limits
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Check if campaign has reached its member limit
    const currentMemberCount = await CampaignMember.countDocuments({
      campaign_id: campaignId,
    });
    const pendingInvitationsCount = await Invitation.countDocuments({
      campaign_id: campaignId,
      status: 'pending',
    });

    if (
      campaign.max_members &&
      currentMemberCount + pendingInvitationsCount >= campaign.max_members
    ) {
      return res
        .status(400)
        .json({ message: 'Campaign has reached its maximum member capacity' });
    }

    // Check if user with this email exists
    const invitedUser = await User.findOne({ email });
    if (!invitedUser) {
      return res
        .status(404)
        .json({ message: 'No user with this email exists in our system' });
    }

    // Check if user is already a member
    const existingMember = await CampaignMember.findOne({
      campaign_id: campaignId,
      user_id: invitedUser._id,
    });

    if (existingMember) {
      return res
        .status(400)
        .json({ message: 'This user is already a member of this campaign' });
    }

    // Check if there's already a pending invitation for this user
    const existingInvitation = await Invitation.findOne({
      campaign_id: campaignId,
      email: email.toLowerCase(),
      status: 'pending',
    });

    if (existingInvitation) {
      return res
        .status(400)
        .json({
          message: 'This user has already been invited to this campaign',
        });
    }

    // Create invitation
    const invitation = new Invitation({
      campaign_id: campaignId,
      email: email.toLowerCase(),
      invited_by: userId,
    });

    await invitation.save();

    // Emit socket event to notify the invited user if they're online
    const io = req.app.get('io');
    if (io) {
      const invitedUserSocketId = [...io.sockets.sockets.values()].find(
        (socket) => socket.userId === invitedUser._id.toString()
      )?.id;

      if (invitedUserSocketId) {
        io.to(invitedUserSocketId).emit('campaign-invitation', {
          invitationId: invitation._id,
          campaignId: campaignId,
          campaignName: campaign.name,
          invitedBy: userId,
        });
      }
    }

    res.status(200).json({
      message: 'Invitation sent successfully',
      invitation: {
        id: invitation._id,
        email: invitation.email,
        status: invitation.status,
        created_at: invitation.createdAt,
      },
    });
  } catch (error) {
    console.error('Error sending invitation:', error);
    res.status(500).json({
      message: 'Failed to send invitation',
      error: error.message,
    });
  }
};

// Get pending invitations for a campaign
exports.getCampaignInvitations = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.userId;
    const { status } = req.query;

    // Check if user is a member of the campaign
    const isMember = await CampaignMember.exists({
      campaign_id: campaignId,
      user_id: userId,
    });

    if (!isMember) {
      return res
        .status(403)
        .json({ message: 'Not authorized to view campaign invitations' });
    }

    // Build query
    const query = { campaign_id: campaignId };
    if (status) {
      query.status = status;
    }

    // Find invitations
    const invitations = await Invitation.find(query)
      .populate('invited_by', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json(invitations);
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({
      message: 'Failed to fetch invitations',
      error: error.message,
    });
  }
};

// Cancel invitation
exports.cancelInvitation = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const invitationId = req.params.invitationId;
    const userId = req.userId;

    // Check if user is an admin of the campaign
    const isAdmin = await CampaignMember.exists({
      campaign_id: campaignId,
      user_id: userId,
      is_admin: true,
    });

    if (!isAdmin) {
      return res
        .status(403)
        .json({ message: 'Not authorized to cancel invitations' });
    }

    // Find and update invitation
    const invitation = await Invitation.findOneAndUpdate(
      { _id: invitationId, campaign_id: campaignId, status: 'pending' },
      { status: 'cancelled' },
      { new: true }
    );

    if (!invitation) {
      return res
        .status(404)
        .json({ message: 'Invitation not found or already processed' });
    }

    res.status(200).json({ message: 'Invitation cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling invitation:', error);
    res.status(500).json({
      message: 'Failed to cancel invitation',
      error: error.message,
    });
  }
};

// Accept or decline invitation
exports.respondToInvitation = async (req, res) => {
  try {
    const { invitationId } = req.params;
    const { action } = req.body; // 'accept' or 'decline'
    const userId = req.userId;
    const userEmail = req.userEmail;

    if (!['accept', 'decline'].includes(action)) {
      return res
        .status(400)
        .json({ message: 'Invalid action. Use "accept" or "decline"' });
    }

    // Find invitation
    const invitation = await Invitation.findOne({
      _id: invitationId,
      email: userEmail.toLowerCase(),
      status: 'pending',
    });

    if (!invitation) {
      return res
        .status(404)
        .json({ message: 'Invitation not found or already processed' });
    }

    if (action === 'accept') {
      // Check if user is already a member
      const existingMember = await CampaignMember.findOne({
        campaign_id: invitation.campaign_id,
        user_id: userId,
      });

      if (existingMember) {
        // Update invitation status
        invitation.status = 'accepted';
        await invitation.save();

        return res
          .status(400)
          .json({ message: 'You are already a member of this campaign' });
      }

      // Check if campaign has reached its member limit
      const campaign = await Campaign.findById(invitation.campaign_id);
      const currentMemberCount = await CampaignMember.countDocuments({
        campaign_id: invitation.campaign_id,
      });

      if (campaign.max_members && currentMemberCount >= campaign.max_members) {
        // Update invitation status
        invitation.status = 'declined';
        await invitation.save();

        return res
          .status(400)
          .json({
            message: 'Campaign has reached its maximum member capacity',
          });
      }

      // Add user as member
      const member = new CampaignMember({
        campaign_id: invitation.campaign_id,
        user_id: userId,
        is_admin: false,
      });

      await member.save();

      // Update invitation status
      invitation.status = 'accepted';
      await invitation.save();

      // Notify campaign creator via socket
      const io = req.app.get('io');
      if (io) {
        const adminIds = await CampaignMember.find({
          campaign_id: invitation.campaign_id,
          is_admin: true,
        }).distinct('user_id');

        for (const adminId of adminIds) {
          const adminSocketId = [...io.sockets.sockets.values()].find(
            (socket) => socket.userId === adminId.toString()
          )?.id;

          if (adminSocketId) {
            io.to(adminSocketId).emit('invitation-accepted', {
              invitationId: invitation._id,
              campaignId: invitation.campaign_id,
              userId: userId,
              userEmail: userEmail,
            });
          }
        }
      }

      res.status(200).json({
        message: 'Invitation accepted. You are now a member of this campaign',
        campaignId: invitation.campaign_id,
      });
    } else {
      // Decline invitation
      invitation.status = 'declined';
      await invitation.save();

      res.status(200).json({ message: 'Invitation declined' });
    }
  } catch (error) {
    console.error('Error responding to invitation:', error);
    res.status(500).json({
      message: 'Failed to process invitation response',
      error: error.message,
    });
  }
};

// Get user's pending invitations
exports.getUserInvitations = async (req, res) => {
  try {
    const userId = req.userId;
    const userEmail = req.userEmail;

    // Find all pending invitations for the user
    const invitations = await Invitation.find({
      email: userEmail.toLowerCase(),
      status: 'pending',
      expires_at: { $gt: new Date() }, // Only active invitations
    })
      .populate({
        path: 'campaign_id',
        select: 'name description target_amount contribution_amount',
      })
      .populate({
        path: 'invited_by',
        select: 'name email',
      });

    res.status(200).json(invitations);
  } catch (error) {
    console.error('Error fetching user invitations:', error);
    res.status(500).json({
      message: 'Failed to fetch invitations',
      error: error.message,
    });
  }
};
