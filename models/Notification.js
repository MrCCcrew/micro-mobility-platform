const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 100
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  type: {
    type: String,
    required: true,
    enum: ['ride', 'payment', 'promotion', 'system', 'warning', 'info']
  },
  priority: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  channels: [{
    type: String,
    enum: ['app', 'email', 'sms', 'push']
  }],
  sentAt: Date,
  expiresAt: Date
}, {
  timestamps: true
});

// Indexes
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ isRead: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Notification', notificationSchema);

