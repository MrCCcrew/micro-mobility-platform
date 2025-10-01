const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'call_center', 'supervisor', 'viewer'],
    required: true
  },
  permissions: {
    dashboard: {
      view: { type: Boolean, default: false },
      analytics: { type: Boolean, default: false }
    },
    users: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      addCredit: { type: Boolean, default: false },
      viewDetails: { type: Boolean, default: false },
      export: { type: Boolean, default: false }
    },
    vehicles: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      disable: { type: Boolean, default: false },
      maintenance: { type: Boolean, default: false },
      tracking: { type: Boolean, default: false }
    },
    rides: {
      view: { type: Boolean, default: false },
      viewDetails: { type: Boolean, default: false },
      endRide: { type: Boolean, default: false },
      refund: { type: Boolean, default: false },
      export: { type: Boolean, default: false }
    },
    zones: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false }
    },
    payments: {
      view: { type: Boolean, default: false },
      refund: { type: Boolean, default: false },
      viewDetails: { type: Boolean, default: false },
      export: { type: Boolean, default: false }
    },
    reports: {
      financial: { type: Boolean, default: false },
      operational: { type: Boolean, default: false },
      analytics: { type: Boolean, default: false },
      export: { type: Boolean, default: false }
    },
    settings: {
      view: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      system: { type: Boolean, default: false }
    },
    admins: {
      view: { type: Boolean, default: false },
      create: { type: Boolean, default: false },
      edit: { type: Boolean, default: false },
      delete: { type: Boolean, default: false },
      permissions: { type: Boolean, default: false }
    }
  },
  profile: {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: String,
    avatar: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

// Hash password before saving
adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
adminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Set default permissions based on role
adminSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('role')) {
    if (this.role === 'super_admin') {
      // Super Admin has all permissions
      this.permissions = {
        dashboard: { view: true, analytics: true },
        users: { view: true, create: true, edit: true, delete: true, addCredit: true, viewDetails: true, export: true },
        vehicles: { view: true, create: true, edit: true, delete: true, disable: true, maintenance: true, tracking: true },
        rides: { view: true, viewDetails: true, endRide: true, refund: true, export: true },
        zones: { view: true, create: true, edit: true, delete: true },
        payments: { view: true, refund: true, viewDetails: true, export: true },
        reports: { financial: true, operational: true, analytics: true, export: true },
        settings: { view: true, edit: true, system: true },
        admins: { view: true, create: true, edit: true, delete: true, permissions: true }
      };
    } else if (this.role === 'admin') {
      // Admin has most permissions except system settings
      this.permissions = {
        dashboard: { view: true, analytics: true },
        users: { view: true, create: true, edit: true, delete: false, addCredit: true, viewDetails: true, export: true },
        vehicles: { view: true, create: true, edit: true, delete: false, disable: true, maintenance: true, tracking: true },
        rides: { view: true, viewDetails: true, endRide: true, refund: true, export: true },
        zones: { view: true, create: true, edit: true, delete: false },
        payments: { view: true, refund: true, viewDetails: true, export: false },
        reports: { financial: true, operational: true, analytics: true, export: true },
        settings: { view: true, edit: true, system: false },
        admins: { view: true, create: false, edit: false, delete: false, permissions: false }
      };
    } else if (this.role === 'call_center') {
      // Call center focused on user support
      this.permissions = {
        dashboard: { view: true, analytics: false },
        users: { view: true, create: false, edit: true, delete: false, addCredit: true, viewDetails: true, export: false },
        vehicles: { view: true, create: false, edit: true, delete: false, disable: true, maintenance: false, tracking: true },
        rides: { view: true, viewDetails: true, endRide: true, refund: true, export: false },
        zones: { view: true, create: false, edit: false, delete: false },
        payments: { view: true, refund: true, viewDetails: true, export: false },
        reports: { financial: false, operational: true, analytics: false, export: false },
        settings: { view: false, edit: false, system: false },
        admins: { view: false, create: false, edit: false, delete: false, permissions: false }
      };
    } else if (this.role === 'supervisor') {
      // Supervisor focused on operations
      this.permissions = {
        dashboard: { view: true, analytics: true },
        users: { view: true, create: false, edit: false, delete: false, addCredit: false, viewDetails: true, export: false },
        vehicles: { view: true, create: false, edit: true, delete: false, disable: true, maintenance: true, tracking: true },
        rides: { view: true, viewDetails: true, endRide: false, refund: false, export: true },
        zones: { view: true, create: false, edit: false, delete: false },
        payments: { view: true, refund: false, viewDetails: false, export: false },
        reports: { financial: false, operational: true, analytics: true, export: true },
        settings: { view: false, edit: false, system: false },
        admins: { view: false, create: false, edit: false, delete: false, permissions: false }
      };
    } else if (this.role === 'viewer') {
      // Viewer has read-only access
      this.permissions = {
        dashboard: { view: true, analytics: false },
        users: { view: true, create: false, edit: false, delete: false, addCredit: false, viewDetails: false, export: false },
        vehicles: { view: true, create: false, edit: false, delete: false, disable: false, maintenance: false, tracking: true },
        rides: { view: true, viewDetails: false, endRide: false, refund: false, export: false },
        zones: { view: true, create: false, edit: false, delete: false },
        payments: { view: false, refund: false, viewDetails: false, export: false },
        reports: { financial: false, operational: true, analytics: false, export: false },
        settings: { view: false, edit: false, system: false },
        admins: { view: false, create: false, edit: false, delete: false, permissions: false }
      };
    }
  }
  next();
});

module.exports = mongoose.model('Admin', adminSchema);