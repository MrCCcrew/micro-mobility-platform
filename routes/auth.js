const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');

const User = require('../models/User');
const { getSignedJwtToken, protect } = require('../middleware/auth');

const router = express.Router();

/* =========================
   Twilio Verify (SMS فقط)
========================= */
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* =========================
   SendGrid (Email عبر Templateك)
========================= */
if (!process.env.SENDGRID_API_KEY) {
  console.warn('⚠️ SENDGRID_API_KEY is not set. Email OTP will fail.');
}
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/* ================
   تخزين OTP للإيميل (ذاكرة مؤقتة)
================ */
const otpStorage = new Map();

/* ===========
   Validators
=========== */
// تبسيط validation للهاتف فقط
const sendOtpValidation = [
  body('phoneNumber')
    .notEmpty().withMessage('phoneNumber is required')
    .matches(/^\+\d{6,15}$/).withMessage('phoneNumber must be in E.164 format (e.g. +9655xxxxxxx)'),
];

const verifyOtpValidation = [
  body('otp').notEmpty().withMessage('OTP is required'),
  body('phoneNumber')
    .notEmpty().withMessage('phoneNumber is required')
    .matches(/^\+\d{6,15}$/).withMessage('phoneNumber must be in E.164 format (e.g. +9655xxxxxxx)'),
];

// validation لإكمال البيانات
const completeProfileValidation = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
];

/* -------------------------------------------------
   @desc   Send OTP (SMS only via Twilio Verify)
   @route  POST /api/auth/send-otp
   @access Public
-------------------------------------------------- */
router.post('/send-otp', sendOtpValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { phoneNumber } = req.body;

    // SMS عبر Twilio Verify فقط
    const verification = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications
      .create({ to: phoneNumber, channel: 'sms' });

    return res.status(200).json({
      success: true,
      message: 'OTP sent via SMS',
      sid: verification.sid,
    });
  } catch (error) {
    console.error('❌ Send OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP: ' + (error?.message || String(error)),
    });
  }
});

/* -------------------------------------------------
   @desc   Verify OTP (Phone only)
   @route  POST /api/auth/verify-otp
   @access Public
-------------------------------------------------- */
router.post('/verify-otp', verifyOtpValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { phoneNumber, otp } = req.body;

    // تحقق عبر Twilio Verify
    const check = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks
      .create({ to: phoneNumber, code: otp });

    if (check.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // ✅ OTP صحيح: تحقق من وجود المستخدم
    let user = await User.findOne({ phone: phoneNumber });

    if (user) {
      // المستخدم موجود ومكتمل البيانات
      if (user.name && user.email && user.name !== `User_${phoneNumber}`) {
        user.isVerified = true;
        await user.save();

        const token = getSignedJwtToken(user._id);
        return res.status(200).json({
          success: true,
          message: 'Login successful',
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            profileComplete: true,
          },
        });
      } else {
        // المستخدم موجود لكن البيانات غير مكتملة
        const token = getSignedJwtToken(user._id);
        return res.status(200).json({
          success: true,
          message: 'OTP verified, please complete your profile',
          token,
          user: {
            id: user._id,
            phone: user.phone,
            profileComplete: false,
          },
        });
      }
    } else {
      // إنشاء مستخدم جديد مؤقت
      user = await User.create({
        phone: phoneNumber,
        name: `User_${phoneNumber}`, // اسم مؤقت
        password: crypto.randomBytes(12).toString('hex'),
        isVerified: true,
      });

      const token = getSignedJwtToken(user._id);
      return res.status(200).json({
        success: true,
        message: 'OTP verified, please complete your profile',
        token,
        user: {
          id: user._id,
          phone: user.phone,
          profileComplete: false,
        },
      });
    }
  } catch (error) {
    console.error('❌ Verify OTP error:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP: ' + error.message });
  }
});

/* -------------------------------------------------
   @desc   Complete Profile (First Name, Last Name, Email)
   @route  POST /api/auth/complete-profile
   @access Private (requires token from verify-otp)
-------------------------------------------------- */
router.post('/complete-profile', completeProfileValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    // استخراج التوكن من الهيدر
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    // التحقق من التوكن
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    const { firstName, lastName, email } = req.body;

    // تحديث بيانات المستخدم
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // تحقق من عدم وجود إيميل مكرر
    const existingUser = await User.findOne({ email, _id: { $ne: userId } });
    if (existingUser) {
      // إذا كان البريد الإلكتروني موجود، قم بتسجيل الدخول التلقائي
      // تحديث بيانات المستخدم الموجود بالاسم الجديد إذا لم يكن مكتملاً
      if (!existingUser.name || existingUser.name.startsWith('User_')) {
        existingUser.name = `${firstName} ${lastName}`;
        await existingUser.save();
      }

      // إنشاء توكن جديد للمستخدم الموجود
      const newToken = getSignedJwtToken(existingUser._id);
      
      return res.status(200).json({
        success: true,
        message: 'Login successful - existing account found',
        token: newToken,
        user: {
          id: existingUser._id,
          name: existingUser.name,
          email: existingUser.email,
          phone: existingUser.phone,
          profileComplete: true,
        },
        autoLogin: true // إشارة للفرونت إند أن هذا تسجيل دخول تلقائي
      });
    }

    user.name = `${firstName} ${lastName}`;
    user.email = email;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile completed successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        profileComplete: true,
      },
    });
  } catch (error) {
    console.error('❌ Complete Profile error:', error);
    return res.status(500).json({ success: false, message: 'Failed to complete profile: ' + error.message });
  }
});

// @desc    Admin login with email and password
// @route   POST /api/auth/login
// @access  Public
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Check if user exists in User model first (for admin users created by createAdmin.js)
    let user = await User.findOne({ email, role: { $in: ['admin', 'super_admin'] } }).select('+password');
    let isAdmin = false;
    
    // If not found in User model, check Admin model
    if (!user) {
      user = await Admin.findOne({ email }).select('+password');
      isAdmin = true;
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Check password
    let isMatch;
    if (isAdmin) {
      isMatch = await user.comparePassword(password);
    } else {
      isMatch = await user.matchPassword(password);
    }
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = getSignedJwtToken(user._id);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username || user.name,
        email: user.email,
        role: user.role,
        profile: user.profile || { firstName: user.name }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
});

// @desc    Update user profile (auth route)
// @route   PUT /api/auth/profile
// @access  Private
router.put('/profile', protect, [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2-50 characters'),
  body('phone').optional().isMobilePhone().withMessage('Please enter a valid phone number'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const updateData = {};
    const { name, phone, dateOfBirth } = req.body;

    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (dateOfBirth) updateData.dateOfBirth = dateOfBirth;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Update profile error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

module.exports = router;
