const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['financial', 'operational'],
    required: true
  },
  period: {
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    }
  },
  
  // Financial Report Data
  financialData: {
    totalRevenue: {
      type: Number,
      default: 0
    },
    totalRides: {
      type: Number,
      default: 0
    },
    averageRideValue: {
      type: Number,
      default: 0
    },
    paymentMethods: {
      visa: {
        amount: { type: Number, default: 0 },
        commission: { type: Number, default: 0 },
        net: { type: Number, default: 0 }
      },
      mastercard: {
        amount: { type: Number, default: 0 },
        commission: { type: Number, default: 0 },
        net: { type: Number, default: 0 }
      },
      vodafoneCash: {
        amount: { type: Number, default: 0 },
        commission: { type: Number, default: 0 },
        net: { type: Number, default: 0 }
      },
      instaPay: {
        amount: { type: Number, default: 0 },
        commission: { type: Number, default: 0 },
        net: { type: Number, default: 0 }
      },
      fawry: {
        amount: { type: Number, default: 0 },
        commission: { type: Number, default: 0 },
        net: { type: Number, default: 0 }
      },
      wallet: {
        amount: { type: Number, default: 0 },
        commission: { type: Number, default: 0 },
        net: { type: Number, default: 0 }
      }
    },
    userTransactions: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      totalSpent: Number,
      totalRides: Number,
      walletTopups: Number,
      ridePayments: Number
    }]
  },
  
  // Operational Report Data
  operationalData: {
    totalVehicles: {
      type: Number,
      default: 0
    },
    activeVehicles: {
      type: Number,
      default: 0
    },
    vehicleUtilization: {
      type: Number,
      default: 0
    },
    totalDistance: {
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
    vehicleStats: [{
      vehicleId: String,
      totalRides: Number,
      totalDistance: Number,
      totalRevenue: Number,
      batteryLevel: Number,
      maintenanceIssues: Number,
      vandalismReports: Number
    }],
    zoneStats: [{
      zoneId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Zone'
      },
      zoneName: String,
      totalRides: Number,
      totalRevenue: Number,
      averageRideDistance: Number
    }]
  },
  
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  
  filters: {
    zones: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Zone'
    }],
    vehicles: [String],
    paymentMethods: [String],
    userTypes: [String]
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Report', reportSchema);