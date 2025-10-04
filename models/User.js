// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters'],
    required: [true, 'Name is required'],
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    unique: true,
    sparse: true,
    required: false, // جعله اختيارياً
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email',
    ],
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    sparse: true,
  },
  password: {
    type: String,
    minlength: 6,
    select: false,
  },

  // معلومات إضافية
  profileImage: String,
  dateOfBirth: Date,
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
  },

  // الحالة والأذونات
  isActive: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  role: {
    type: String,
    enum: ['user', 'admin', 'super_admin'],
    default: 'user',
  },

  // التفضيلات
  preferences: {
    language: { type: String, default: 'en' },
    currency: { type: String, default: 'USD' },
  },

  // التحقق عبر رابط
  verificationToken: { type: String },

  // طرق دفع محفوظة (PayPal)
  paymentMethods: [
    {
      provider: {
        type: String,
        enum: ['paypal', 'cash'],
        default: 'paypal'
      },
      email: String, // للPayPal
      isDefault: { type: Boolean, default: false },
    },
  ],
  // إضافة حقول المحفظة
  wallet: {
    balance: {
      type: Number,
      default: 0,
      min: 0
    },
    currency: {
      type: String,
      default: 'EGP',
      enum: ['USD', 'EUR', 'EGP', 'SAR', 'AED', 'GBP', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD']
    },
    transactions: [{
      id: {
        type: String,
        required: true
      },
      type: {
        type: String,
        enum: ['topup', 'ride', 'refund', 'bonus'],
        required: true
      },
      amount: {
        type: Number,
        required: true
      },
      currency: {
        type: String,
        required: true
      },
      description: {
        type: String,
        required: true
      },
      paymentMethod: {
        type: String,
        enum: ['paypal', 'card', 'cash', 'bonus'],
        default: 'paypal'
      },
      paymentId: String, // PayPal order ID أو transaction ID
      status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  // إضافة معلومات الموقع والعملة
  location: {
    country: {
      code: String,
      name: String,
      currency: String,
      symbol: String
    },
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
}, {
  timestamps: true
});

// تشفير كلمة المرور قبل الحفظ
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// مقارنة كلمة المرور
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
