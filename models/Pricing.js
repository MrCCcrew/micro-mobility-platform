const mongoose = require('mongoose');

const pricingSchema = new mongoose.Schema({
  vehicleType: {
    type: String,
    required: true,
    enum: ['scooter', 'bike', 'ebike', 'moped'],
    unique: true
  },
  baseFee: {
    type: Number,
    required: true,
    min: 0
  },
  perMinuteRate: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    default: 'USD'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  validFrom: {
    type: Date,
    default: Date.now
  },
  validTo: {
    type: Date,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Index for faster queries
pricingSchema.index({ vehicleType: 1, isActive: 1 });
pricingSchema.index({ validFrom: 1, validTo: 1 });

module.exports = mongoose.model('Pricing', pricingSchema);

