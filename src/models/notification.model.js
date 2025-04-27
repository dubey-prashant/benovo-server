const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['invitation', 'message', 'update', 'payment', 'system'],
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    data: {
      type: Object,
      default: {},
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index to improve query performance
notificationSchema.index({ user_id: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
