const mongoose = require('mongoose');

const zoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  city: {
    type: String,
    required: true
  },
  country: {
    type: String,
    required: true
  },
  
  // Geographic boundaries
  boundaries: {
    type: {
      type: String,
      enum: ['Polygon'],
      required: true
    },
    coordinates: {
      type: [[[Number]]], // Array of arrays of coordinates [longitude, latitude]
      required: true
    }
  },
  
  // Zone center for display
  center: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  
  // Zone configuration
  isActive: {
    type: Boolean,
    default: true
  },
  maxVehicles: {
    type: Number,
    required: true,
    min: 1
  },
  currentVehicles: {
    type: Number,
    default: 0
  },
  
  // Operating hours
  operatingHours: {
    start: {
      type: String,
      required: true,
      match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
    },
    end: {
      type: String,
      required: true,
      match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
    },
    timezone: {
      type: String,
      required: true,
      default: 'UTC'
    }
  },
  
  // Pricing for this zone
  pricing: {
    scooter: {
      unlockFee: {
        type: Number,
        required: true,
        min: 0
      },
      perMinuteRate: {
        type: Number,
        required: true,
        min: 0
      }
    },
    bike: {
      unlockFee: {
        type: Number,
        required: true,
        min: 0
      },
      perMinuteRate: {
        type: Number,
        required: true,
        min: 0
      }
    },
    currency: {
      type: String,
      required: true,
      default: 'USD'
    },
    
    // Special pricing
    dayRental: {
      scooter: {
        dailyRate: Number,
        minimumDays: {
          type: Number,
          default: 2
        },
        deliveryFee: Number
      },
      bike: {
        dailyRate: Number,
        minimumDays: {
          type: Number,
          default: 2
        },
        deliveryFee: Number
      }
    }
  },
  
  // Parking rules
  parkingRules: {
    allowedAreas: [{
      name: String,
      boundaries: {
        type: {
          type: String,
          enum: ['Polygon']
        },
        coordinates: [[[Number]]]
      }
    }],
    forbiddenAreas: [{
      name: String,
      boundaries: {
        type: {
          type: String,
          enum: ['Polygon']
        },
        coordinates: [[[Number]]]
      },
      penalty: Number
    }],
    requiresRack: {
      type: Boolean,
      default: false
    },
    penaltyForImproperParking: {
      type: Number,
      default: 0
    }
  },
  
  // Speed limits
  speedLimits: [{
    area: {
      name: String,
      boundaries: {
        type: {
          type: String,
          enum: ['Polygon']
        },
        coordinates: [[[Number]]]
      }
    },
    maxSpeed: {
      type: Number,
      required: true // km/h
    }
  }],
  
  // Zone statistics
  stats: {
    totalRides: {
      type: Number,
      default: 0
    },
    totalRevenue: {
      type: Number,
      default: 0
    },
    averageRideDistance: {
      type: Number,
      default: 0
    },
    averageRideDuration: {
      type: Number,
      default: 0
    },
    popularHours: [{
      hour: Number,
      rideCount: Number
    }]
  },
  
  // Contact and support
  supportContact: {
    phone: String,
    email: String,
    address: String
  },
  
  // Images and media
  images: [{
    url: String,
    type: {
      type: String,
      enum: ['cover', 'map', 'promotional']
    },
    caption: String
  }],
  
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Geospatial indexes
zoneSchema.index({ boundaries: '2dsphere' });
zoneSchema.index({ center: '2dsphere' });
zoneSchema.index({ city: 1, country: 1 });
zoneSchema.index({ isActive: 1 });

// Method to check if a point is within the zone
zoneSchema.methods.containsPoint = function(longitude, latitude) {
  // This would typically use MongoDB's $geoWithin operator
  // For now, we'll add a simple point-in-polygon check
  return true; // Placeholder
};

// Method to check if zone is currently operating
zoneSchema.methods.isOperating = function() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  
  const startParts = this.operatingHours.start.split(':');
  const endParts = this.operatingHours.end.split(':');
  const startTime = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
  const endTime = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
  
  if (endTime > startTime) {
    return currentTime >= startTime && currentTime <= endTime;
  } else {
    // Handles overnight operations (e.g., 22:00 - 06:00)
    return currentTime >= startTime || currentTime <= endTime;
  }
};

module.exports = mongoose.model('Zone', zoneSchema);
