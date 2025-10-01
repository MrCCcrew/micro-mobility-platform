const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
  vehicleId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  qrCode: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['scooter', 'bike'],
    required: true
  },
  model: {
    type: String,
    required: true
  },
  brand: {
    type: String,
    required: true
  },
  
  // Current status and location
  status: {
    type: String,
    enum: ['available', 'in_use', 'maintenance', 'charging', 'damaged', 'lost'],
    default: 'available'
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      index: '2dsphere'
    }
  },
  address: {
    type: String,
    required: true
  },
  zone: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
    required: true
  },
  
  // Battery and technical specs
  batteryLevel: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  maxSpeed: {
    type: Number,
    required: true // km/h
  },
  range: {
    type: Number,
    required: true // km on full battery
  },
  weight: {
    type: Number,
    required: true // kg
  },
  maxLoad: {
    type: Number,
    required: true // kg
  },
  
  // Pricing
  pricing: {
    unlockFee: {
      type: Number,
      default: 0
    },
    perMinuteRate: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'USD'
    }
  },
  
  // Usage statistics
  totalRides: {
    type: Number,
    default: 0
  },
  totalDistance: {
    type: Number,
    default: 0 // km
  },
  totalRevenue: {
    type: Number,
    default: 0
  },
  
  // Maintenance
  lastMaintenance: {
    type: Date,
    default: Date.now
  },
  nextMaintenance: Date,
  maintenanceNotes: [{
    date: {
      type: Date,
      default: Date.now
    },
    type: {
      type: String,
      enum: ['routine', 'repair', 'battery', 'tire', 'brake', 'other']
    },
    description: String,
    cost: Number,
    technician: String
  }],
  
  // IoT and connectivity
  iot: {
    deviceId: String,
    firmwareVersion: String,
    lastHeartbeat: Date,
    gpsAccuracy: Number,
    signalStrength: Number
  },
  
  // Security
  hasLock: {
    type: Boolean,
    default: false
  },
  lockType: {
    type: String,
    enum: ['cable', 'u-lock', 'integrated']
  },
  
  // Media
  images: [{
    url: String,
    type: {
      type: String,
      enum: ['main', 'damage', 'maintenance']
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Current ride reference
  currentRide: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ride',
    default: null
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // إضافة حقول جديدة للتتبع المتقدم
  alerts: [{
    type: {
      type: String,
      enum: ['low_battery', 'out_of_zone', 'maintenance_due', 'damage_reported', 'theft_attempt']
    },
    message: String,
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    },
    isActive: {
      type: Boolean,
      default: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    resolvedAt: Date,
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    }
  }],

  supervisorNotes: [{
    note: String,
    type: {
      type: String,
      enum: ['maintenance', 'damage', 'vandalism', 'general']
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better performance
vehicleSchema.index({ location: '2dsphere' });
vehicleSchema.index({ status: 1, location: 1 });
vehicleSchema.index({ zone: 1, status: 1 });
vehicleSchema.index({ vehicleId: 1 });
vehicleSchema.index({ 'alerts.isActive': 1, 'alerts.type': 1 });

// Virtual for availability check
vehicleSchema.virtual('isAvailable').get(function() {
  return this.status === 'available' && 
         this.batteryLevel > 10 && 
         this.isActive;
});

// Method to calculate distance to a point
vehicleSchema.methods.distanceTo = function(longitude, latitude) {
  const R = 6371; // Earth's radius in km
  const dLat = (latitude - this.location.coordinates[1]) * Math.PI / 180;
  const dLon = (longitude - this.location.coordinates[0]) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(this.location.coordinates[1] * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in km
};

// Pre-save middleware to generate CTS ID
vehicleSchema.pre('save', async function(next) {
  if (!this.vehicleId) {
    const count = await this.constructor.countDocuments();
    this.vehicleId = `CTS${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

// Method to check if vehicle is out of zone
vehicleSchema.methods.checkZoneViolation = async function() {
  const Zone = mongoose.model('Zone');
  const zone = await Zone.findById(this.zone);
  
  if (zone) {
    const isInZone = zone.containsPoint(this.location.coordinates[0], this.location.coordinates[1]);
    if (!isInZone) {
      // Add alert if not already exists
      const existingAlert = this.alerts.find(alert => 
        alert.type === 'out_of_zone' && alert.isActive
      );
      
      if (!existingAlert) {
        this.alerts.push({
          type: 'out_of_zone',
          message: `Vehicle ${this.vehicleId} is outside its designated zone`,
          severity: 'high'
        });
        await this.save();
      }
      return false;
    }
  }
  return true;
};

// Method to check battery level
vehicleSchema.methods.checkBatteryLevel = async function() {
  if (this.batteryLevel <= 25) {
    const existingAlert = this.alerts.find(alert => 
      alert.type === 'low_battery' && alert.isActive
    );
    
    if (!existingAlert) {
      this.alerts.push({
        type: 'low_battery',
        message: `Vehicle ${this.vehicleId} has low battery: ${this.batteryLevel}%`,
        severity: this.batteryLevel <= 10 ? 'critical' : 'high'
      });
      await this.save();
    }
  }
};

module.exports = mongoose.model('Vehicle', vehicleSchema);
