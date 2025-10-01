const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  rideId: {
    type: String,
    required: true,
    unique: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  vehicle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  
  // Ride timing
  startTime: {
    type: Date,
    required: true,
    default: Date.now
  },
  endTime: {
    type: Date,
    default: null
  },
  duration: {
    type: Number, // in minutes
    default: 0
  },
  
  // Location information
  startLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    },
    address: String
  },
  endLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: null
    },
    address: String
  },
  
  // Route tracking
  route: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: [Number] // [longitude, latitude]
    },
    speed: Number, // km/h
    batteryLevel: Number
  }],
  
  // Distance and metrics
  distance: {
    type: Number,
    default: 0 // in kilometers
  },
  maxSpeed: {
    type: Number,
    default: 0 // km/h
  },
  avgSpeed: {
    type: Number,
    default: 0 // km/h
  },
  
  // Pricing and payment
  pricing: {
    unlockFee: {
      type: Number,
      required: true
    },
    perMinuteRate: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      required: true,
      default: 'USD'
    }
  },
  cost: {
    unlockFee: {
      type: Number,
      required: true
    },
    rideFee: {
      type: Number,
      default: 0
    },
    extraFees: [{
      type: String,
      amount: Number,
      reason: String
    }],
    discount: {
      type: Number,
      default: 0
    },
    total: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      required: true
    }
  },
  
  // Payment information
  payment: {
    method: {
      type: String,
      enum: ['card', 'wallet', 'cash'],
      required: true
    },
    payment: {
      provider: {
        type: String,
        enum: ['paypal', 'cash'],
        default: 'paypal'
      },
      orderId: String, // PayPal Order ID
      captureId: String, // PayPal Capture ID
      amount: {
        type: Number,
        required: true
      },
      currency: {
        type: String,
        default: 'USD'
      },
      status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
      },
      paidAt: Date,
      refundedAt: Date
    },
    transactionId: String,
    stripePaymentIntentId: String,
    paidAt: Date,
    refundedAt: Date,
    refundAmount: Number
  },
  
  // Ride status
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled', 'paused'],
    default: 'active'
  },
  
  // Issues and feedback
  issues: [{
    type: {
      type: String,
      enum: ['vehicle_damage', 'payment_issue', 'app_problem', 'safety_concern', 'other']
    },
    description: String,
    reportedAt: {
      type: Date,
      default: Date.now
    },
    resolved: {
      type: Boolean,
      default: false
    },
    resolution: String
  }],
  
  // User feedback
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: null
  },
  feedback: {
    type: String,
    maxlength: 500
  },
  
  // Additional charges
  parkingViolation: {
    fee: {
      type: Number,
      default: 0
    },
    reason: String,
    location: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: [Number]
    }
  },
  
  // Pause information (for long stops)
  pauses: [{
    startTime: Date,
    endTime: Date,
    location: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: [Number]
    },
    reason: {
      type: String,
      enum: ['user_pause', 'battery_low', 'maintenance', 'other']
    }
  }],
  
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
rideSchema.index({ user: 1, createdAt: -1 });
rideSchema.index({ vehicle: 1, createdAt: -1 });
rideSchema.index({ status: 1, createdAt: -1 });
rideSchema.index({ startLocation: '2dsphere' });
rideSchema.index({ endLocation: '2dsphere' });

// Calculate duration before saving
rideSchema.pre('save', function(next) {
  if (this.endTime && this.startTime) {
    this.duration = Math.round((this.endTime - this.startTime) / (1000 * 60)); // minutes
  }
  next();
});

// Calculate total cost
rideSchema.methods.calculateCost = function() {
  const unlockFee = this.cost.unlockFee || 0;
  const rideFee = this.duration * this.pricing.perMinuteRate;
  const extraFees = this.cost.extraFees.reduce((sum, fee) => sum + fee.amount, 0);
  const parkingFee = this.parkingViolation.fee || 0;
  const discount = this.cost.discount || 0;
  
  this.cost.rideFee = rideFee;
  this.cost.total = unlockFee + rideFee + extraFees + parkingFee - discount;
  
  return this.cost.total;
};

// Calculate average speed
rideSchema.methods.calculateAvgSpeed = function() {
  if (this.distance > 0 && this.duration > 0) {
    this.avgSpeed = (this.distance / (this.duration / 60)); // km/h
  }
  return this.avgSpeed;
};

module.exports = mongoose.model('Ride', rideSchema);
