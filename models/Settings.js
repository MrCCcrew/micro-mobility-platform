const mongoose = require('mongoose');

const GeneralSettingsSchema = new mongoose.Schema({
  siteName: {
    type: String,
    default: 'Micro Mobility Platform'
  },
  siteDescription: {
    type: String,
    default: 'Modern scooter sharing platform'
  },
  contactEmail: {
    type: String,
    default: 'admin@example.com'
  },
  supportPhone: {
    type: String,
    default: '+1234567890'
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  language: {
    type: String,
    default: 'en'
  },
  currency: {
    type: String,
    default: 'USD'
  },
  maintenanceMode: {
    type: Boolean,
    default: false
  }
});

const PricingSettingsSchema = new mongoose.Schema({
  unlockFee: {
    type: Number,
    default: 1.0
  },
  perMinuteRate: {
    type: Number,
    default: 0.15
  },
  maxDailyRate: {
    type: Number,
    default: 25.0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  taxRate: {
    type: Number,
    default: 0.08
  }
});

const NotificationSettingsSchema = new mongoose.Schema({
  emailNotifications: {
    type: Boolean,
    default: true
  },
  smsNotifications: {
    type: Boolean,
    default: true
  },
  pushNotifications: {
    type: Boolean,
    default: true
  },
  rideStartNotification: {
    type: Boolean,
    default: true
  },
  rideEndNotification: {
    type: Boolean,
    default: true
  },
  lowBatteryAlert: {
    type: Boolean,
    default: true
  },
  maintenanceAlert: {
    type: Boolean,
    default: true
  }
});

const SecuritySettingsSchema = new mongoose.Schema({
  passwordMinLength: {
    type: Number,
    default: 8
  },
  requireSpecialChars: {
    type: Boolean,
    default: true
  },
  sessionTimeout: {
    type: Number,
    default: 3600 // seconds
  },
  maxLoginAttempts: {
    type: Number,
    default: 5
  },
  lockoutDuration: {
    type: Number,
    default: 900 // seconds
  },
  twoFactorAuth: {
    type: Boolean,
    default: false
  }
});

const SystemSettingsSchema = new mongoose.Schema({
  autoBackup: {
    type: Boolean,
    default: true
  },
  backupFrequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    default: 'daily'
  },
  logLevel: {
    type: String,
    enum: ['error', 'warn', 'info', 'debug'],
    default: 'info'
  },
  maxLogSize: {
    type: Number,
    default: 100 // MB
  },
  apiRateLimit: {
    type: Number,
    default: 100 // requests per minute
  }
});

const IntegrationSettingsSchema = new mongoose.Schema({
  paypalEnabled: {
    type: Boolean,
    default: false
  },
  stripeEnabled: {
    type: Boolean,
    default: false
  },
  twilioEnabled: {
    type: Boolean,
    default: false
  },
  googleMapsApiKey: {
    type: String,
    default: ''
  },
  firebaseConfig: {
    type: Object,
    default: {}
  }
});

const AnalyticsSettingsSchema = new mongoose.Schema({
  trackUserBehavior: {
    type: Boolean,
    default: true
  },
  trackRidePatterns: {
    type: Boolean,
    default: true
  },
  dataRetentionDays: {
    type: Number,
    default: 365
  },
  anonymizeData: {
    type: Boolean,
    default: true
  }
});

const SettingsSchema = new mongoose.Schema({
  general: {
    type: GeneralSettingsSchema,
    default: () => ({})
  },
  pricing: {
    type: PricingSettingsSchema,
    default: () => ({})
  },
  notifications: {
    type: NotificationSettingsSchema,
    default: () => ({})
  },
  security: {
    type: SecuritySettingsSchema,
    default: () => ({})
  },
  system: {
    type: SystemSettingsSchema,
    default: () => ({})
  },
  integrations: {
    type: IntegrationSettingsSchema,
    default: () => ({})
  },
  analytics: {
    type: AnalyticsSettingsSchema,
    default: () => ({})
  }
}, {
  timestamps: true
});

// Static method to get settings (creates default if doesn't exist)
SettingsSchema.statics.getSettings = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

// Static method to update settings
SettingsSchema.statics.updateSettings = async function(updates) {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create(updates);
  } else {
    Object.keys(updates).forEach(key => {
      if (settings[key] && typeof settings[key] === 'object') {
        Object.assign(settings[key], updates[key]);
      } else {
        settings[key] = updates[key];
      }
    });
    await settings.save();
  }
  return settings;
};

module.exports = mongoose.model('Settings', SettingsSchema);