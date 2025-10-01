const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  ride: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'USD'
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['credit_card', 'debit_card', 'paypal', 'apple_pay', 'google_pay', 'wallet']
  },
  paymentProvider: {
    type: String,
    required: true,
    enum: ['stripe', 'paypal', 'square', 'local']
  },
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled'],
    default: 'pending'
  },
  paymentDetails: {
    unlockFee: Number,
    rideFee: Number,
    tax: Number,
    discount: Number,
    totalAmount: Number
  },
  refundAmount: {
    type: Number,
    default: 0
  },
  refundReason: String,
  failureReason: String,
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

// Indexes
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ ride: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ transactionId: 1 });

module.exports = mongoose.model('Payment', paymentSchema);

