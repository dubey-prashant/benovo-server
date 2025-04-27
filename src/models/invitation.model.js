const mongoose = require('mongoose');

const invitationSchema = new mongoose.Schema(
  {
    campaign_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    invited_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'cancelled'],
      default: 'pending',
    },
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    },
  },
  { timestamps: true }
);

// Compound index to prevent duplicate invitations
invitationSchema.index({ campaign_id: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('Invitation', invitationSchema);
