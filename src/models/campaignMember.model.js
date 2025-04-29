const mongoose = require('mongoose');

const campaignMemberSchema = new mongoose.Schema(
  {
    campaign_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    is_admin: {
      type: Boolean,
      default: false,
    },
    // Add month allocation field
    allocated_month: {
      type: Date,
      default: null,
    },
    // Whether the member has received their payout for their allocated month
    has_received_payout: {
      type: Boolean,
      default: false,
    },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Compound index to ensure a user can only be added once to a campaign
campaignMemberSchema.index({ campaign_id: 1, user_id: 1 }, { unique: true });

module.exports = mongoose.model('CampaignMember', campaignMemberSchema);
