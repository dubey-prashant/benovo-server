const Campaign = require('../models/campaign.model');
const CampaignMember = require('../models/campaignMember.model');
const User = require('../models/user.model');
const Invitation = require('../models/invitation.model');
const Contribution = require('../models/contribution.model');

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
    const { id } = req.params;
    const userId = req.userId;

    // Find campaign by ID
    const campaign = await Campaign.findById(id);

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Check if user is a member
    const isMember = await CampaignMember.exists({
      campaign_id: id,
      user_id: userId,
    });

    if (!isMember) {
      return res
        .status(403)
        .json({ message: 'Not authorized to view this campaign' });
    }

    // Get campaign members with user details
    const members = await CampaignMember.find({ campaign_id: id }).populate(
      'user_id',
      '_id name email'
    );

    const memberDetails = members.map((member) => ({
      ...member.toObject(),
      user: member.user_id,
      user_id: member.user_id._id,
    }));

    // Get pending invitations
    const invitations = await Invitation.find({
      campaign_id: id,
      status: 'pending',
    }).select('email invited_by status created_at');

    // Get contributions
    const contributions = await Contribution.find({ campaign_id: id })
      .populate('contributor_id', 'name email')
      .populate('recipient_id', 'name email')
      .sort({ created_at: -1 });

    // Add members and invitations to campaign
    const campaignWithDetails = {
      ...campaign._doc,
      members: memberDetails,
      invitations,
      contributions,
    };

    res.status(200).json(campaignWithDetails);
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({
      message: 'Failed to fetch campaign',
      error: error.message,
    });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Find the campaign
    const campaign = await Campaign.findById(id);

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Check if user is an admin of the campaign
    const isAdmin = await CampaignMember.exists({
      campaign_id: id,
      user_id: userId,
      is_admin: true,
    });

    if (!isAdmin) {
      return res.status(403).json({
        message: 'Not authorized to delete this campaign',
      });
    }

    // Delete all members
    await CampaignMember.deleteMany({ campaign_id: id });

    // Delete all invitations
    await Invitation.deleteMany({ campaign_id: id });

    // Delete the campaign
    await Campaign.findByIdAndDelete(id);

    // Notify all members via socket if available
    const io = req.app.get('io');
    if (io) {
      // Get all member user IDs except the one who deleted the campaign
      const memberUserIds = await CampaignMember.find({
        campaign_id: id,
        user_id: { $ne: userId },
      }).distinct('user_id');

      // Send notification to each connected member
      memberUserIds.forEach((memberId) => {
        const memberSocketId = [...io.sockets.sockets.values()].find(
          (socket) => socket.userId === memberId.toString()
        )?.id;

        if (memberSocketId) {
          io.to(memberSocketId).emit('campaign-deleted', {
            campaignId: id,
            message: `Campaign "${campaign.name}" has been deleted`,
          });
        }
      });
    }

    res.status(200).json({
      message: 'Campaign deleted successfully',
      campaignId: id,
    });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({
      message: 'Failed to delete campaign',
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
      return res.status(400).json({
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

        return res.status(400).json({
          message: 'Campaign has reached its maximum member capacity',
        });
      }

      // Calculate the next available month
      const startDate = campaign.start_date;
      const existingMembers = await CampaignMember.find({
        campaign_id: invitation.campaign_id,
      }).sort({ allocated_month: 1 });

      // Find the next available month
      let allocatedMonth = new Date(startDate);
      const allocatedMonths = existingMembers
        .filter((m) => m.allocated_month)
        .map((m) => m.allocated_month.getTime());

      // If we have existing allocations, find the next available slot
      if (allocatedMonths.length > 0) {
        for (let i = 0; i < campaign.max_members; i++) {
          const testDate = new Date(startDate);
          testDate.setMonth(testDate.getMonth() + i);

          if (!allocatedMonths.includes(testDate.getTime())) {
            allocatedMonth = testDate;
            break;
          }
        }
      }

      // Add user as member
      const member = new CampaignMember({
        campaign_id: invitation.campaign_id,
        user_id: userId,
        is_admin: false,
        allocated_month: allocatedMonth,
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

exports.updateMemberAllocation = async (req, res) => {
  try {
    const { id, memberId } = req.params;
    const campaignId = id;
    const { allocated_month, has_received_payout } = req.body;
    const userId = req.userId;

    // Check if user is an admin
    const isAdmin = await CampaignMember.exists({
      campaign_id: campaignId,
      user_id: userId,
      is_admin: true,
    });

    if (!isAdmin) {
      return res
        .status(403)
        .json({ message: 'Not authorized to update member allocations' });
    }

    // Prepare update object
    const updateData = {};
    if (allocated_month !== undefined) {
      // Check if allocation date is already taken
      const existingAllocation = await CampaignMember.findOne({
        campaign_id: campaignId,
        allocated_month: new Date(allocated_month),
        _id: { $ne: memberId },
      });

      if (existingAllocation) {
        return res.status(400).json({
          message: 'This month is already allocated to another member',
        });
      }

      updateData.allocated_month = new Date(allocated_month);
    }

    // Add payout status update if provided
    if (has_received_payout !== undefined) {
      updateData.has_received_payout = has_received_payout;
    }

    // Update the member's allocation
    const updatedMember = await CampaignMember.findOneAndUpdate(
      { _id: memberId, campaign_id: campaignId },
      updateData,
      { new: true }
    );

    if (!updatedMember) {
      return res.status(404).json({ message: 'Member not found' });
    }

    res.status(200).json({
      message: 'Member allocation updated successfully',
      member: updatedMember,
    });
  } catch (error) {
    console.error('Error updating member allocation:', error);
    res.status(500).json({
      message: 'Failed to update member allocation',
      error: error.message,
    });
  }
};

exports.removeMember = async (req, res) => {
  try {
    const { id, memberId } = req.params;
    const campaignId = id;
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
        .json({ message: 'Not authorized to remove members' });
    }

    // Find the member to be removed
    const memberToRemove = await CampaignMember.findOne({
      _id: memberId,
      campaign_id: campaignId,
    }).populate('user_id', 'name email');

    if (!memberToRemove) {
      return res.status(404).json({ message: 'Member not found' });
    }

    // Prevent removing an admin
    if (memberToRemove.is_admin) {
      return res.status(400).json({ message: 'Cannot remove an admin member' });
    }

    // Delete the member
    await CampaignMember.deleteOne({ _id: memberId });

    // Notify the removed user via socket if available
    const io = req.app.get('io');
    if (io && memberToRemove.user_id) {
      const memberSocketId = [...io.sockets.sockets.values()].find(
        (socket) => socket.userId === memberToRemove.user_id._id.toString()
      )?.id;

      if (memberSocketId) {
        io.to(memberSocketId).emit('removed-from-campaign', {
          campaignId: campaignId,
          message: 'You have been removed from the campaign',
        });
      }
    }

    res.status(200).json({
      message: 'Member removed successfully',
      removedMember: {
        id: memberToRemove._id,
        name: memberToRemove.user_id?.name || 'Unknown User',
        email: memberToRemove.user_id?.email || '',
      },
    });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({
      message: 'Failed to remove member',
      error: error.message,
    });
  }
};

/**
 * Record a new contribution/payment
 */
exports.recordContribution = async (req, res) => {
  try {
    const { id } = req.params;
    const campaignId = id;
    const { amount, recipient_id, notes } = req.body;
    const contributor_id = req.userId;

    // Validate the campaign exists
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found' });
    }

    // Validate contributor is a campaign member
    const contributorIsMember = await CampaignMember.exists({
      campaign_id: campaignId,
      user_id: contributor_id,
    });

    if (!contributorIsMember) {
      return res.status(403).json({
        message: 'You must be a member of the campaign to make contributions',
      });
    }

    // Validate recipient is a campaign member
    const recipientIsMember = await CampaignMember.exists({
      campaign_id: campaignId,
      user_id: recipient_id,
    });

    if (!recipientIsMember) {
      return res.status(400).json({
        message: 'Recipient must be a member of the campaign',
      });
    }

    // Create the contribution record
    const contribution = new Contribution({
      campaign_id: campaignId,
      contributor_id,
      recipient_id,
      amount,
      notes,
      created_at: new Date(),
    });

    await contribution.save();

    // If this is current month's recipient, update their payout status
    const recipientMember = await CampaignMember.findOne({
      campaign_id: campaignId,
      user_id: recipient_id,
    });

    if (recipientMember && recipientMember.allocated_month) {
      const now = new Date();
      const allocationMonth = new Date(recipientMember.allocated_month);

      if (
        allocationMonth.getMonth() === now.getMonth() &&
        allocationMonth.getFullYear() === now.getFullYear()
      ) {
        // Count contributions for this member this month
        const contributionCount = await Contribution.countDocuments({
          campaign_id: campaignId,
          recipient_id,
          created_at: {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
          },
        });

        // If all members have paid (minus the recipient themselves)
        const totalMembers = await CampaignMember.countDocuments({
          campaign_id: campaignId,
        });

        if (contributionCount >= totalMembers - 1) {
          // Mark as having received payout
          recipientMember.has_received_payout = true;
          await recipientMember.save();
        }
      }
    }

    // Notify the recipient via socket if available
    const io = req.app.get('io');
    if (io) {
      const recipientSocketId = [...io.sockets.sockets.values()].find(
        (socket) => socket.userId === recipient_id
      )?.id;

      if (recipientSocketId) {
        io.to(recipientSocketId).emit('payment-received', {
          campaignId,
          amount,
          from: contributor_id,
          contributionId: contribution._id,
        });
      }
    }

    // Return the created contribution
    const populatedContribution = await Contribution.findById(contribution._id)
      .populate('contributor_id', 'name email')
      .populate('recipient_id', 'name email');

    res.status(201).json({
      message: 'Contribution recorded successfully',
      contribution: populatedContribution,
    });
  } catch (error) {
    console.error('Error recording contribution:', error);
    res.status(500).json({
      message: 'Failed to record contribution',
      error: error.message,
    });
  }
};

/**
 * Get all contributions for a campaign
 */
exports.getCampaignContributions = async (req, res) => {
  try {
    const { id } = req.params;
    const campaignId = id;
    const userId = req.userId;

    // Check if user is a member of the campaign
    const isMember = await CampaignMember.exists({
      campaign_id: campaignId,
      user_id: userId,
    });

    if (!isMember) {
      return res.status(403).json({
        message: 'Not authorized to view campaign contributions',
      });
    }

    // Get all contributions for the campaign
    const contributions = await Contribution.find({ campaign_id: campaignId })
      .populate('contributor_id', 'name email')
      .populate('recipient_id', 'name email')
      .sort({ created_at: -1 });

    res.status(200).json(contributions);
  } catch (error) {
    console.error('Error fetching campaign contributions:', error);
    res.status(500).json({
      message: 'Failed to fetch contributions',
      error: error.message,
    });
  }
};

/**
 * Get all contributions made by or received by the current user
 */
exports.getUserContributions = async (req, res) => {
  try {
    const userId = req.userId;

    // Get all contributions where the user is either contributor or recipient
    const contributions = await Contribution.find({
      $or: [{ contributor_id: userId }, { recipient_id: userId }],
    })
      .populate('campaign_id', 'name')
      .populate('contributor_id', 'name email')
      .populate('recipient_id', 'name email')
      .sort({ created_at: -1 });

    res.status(200).json(contributions);
  } catch (error) {
    console.error('Error fetching user contributions:', error);
    res.status(500).json({
      message: 'Failed to fetch contributions',
      error: error.message,
    });
  }
};
