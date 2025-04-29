const mongoose = require('mongoose');

const contributionSchema = new mongoose.Schema({
  campaign_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    required: true,
  },
  contributor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  recipient_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  notes: {
    type: String,
    default: '',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

// Add index for faster lookups
contributionSchema.index({ campaign_id: 1, created_at: -1 });
contributionSchema.index({ contributor_id: 1, created_at: -1 });
contributionSchema.index({ recipient_id: 1, created_at: -1 });

const Contribution = mongoose.model('Contribution', contributionSchema);

module.exports = Contribution;
