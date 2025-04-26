const Campaign = require('../models/campaign.model');
const CampaignMember = require('../models/campaignMember.model');

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
    const members = await CampaignMember.find({
      campaign_id: campaignId,
    }).populate('user_id', '_id name email phone');

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

exports.inviteMember = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const userId = req.userId;
    const { email, phone } = req.body;

    if (!email && !phone) {
      return res
        .status(400)
        .json({ message: 'Either email or phone is required' });
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

    // TODO: Implement invitation logic
    // For now, we'll just simulate it with a success response

    res.status(200).json({
      message: 'Invitation sent successfully',
    });

    // In a real implementation, we would:
    // 1. Create an invitation record
    // 2. Send an email/SMS to the invitee
    // 3. Provide a unique link for them to join
  } catch (error) {
    res.status(500).json({
      message: 'Failed to send invitation',
      error: error.message,
    });
  }
};
