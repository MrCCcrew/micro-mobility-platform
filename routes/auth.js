const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');

const User = require('../models/User');
const { getSignedJwtToken } = require('../middleware/auth');

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
const sendOtpValidation = [
  body('method').optional().isIn(['phone', 'email']).withMessage('method must be phone or email'),
  body('phoneNumber')
    .if(body('method').equals('phone'))
    .notEmpty().withMessage('phoneNumber is required')
    .bail()
    .matches(/^\+\d{6,15}$/).withMessage('phoneNumber must be in E.164 format (e.g. +9655xxxxxxx)'),
  body('email')
    .if(body('method').equals('email'))
    .isEmail().withMessage('Valid email is required'),
];

const verifyOtpValidation = [
  body('method').optional().isIn(['phone', 'email']).withMessage('method must be phone or email'),
  body('otp').notEmpty().withMessage('OTP is required'),
  body('phoneNumber')
    .if(body('method').equals('phone'))
    .notEmpty().withMessage('phoneNumber is required')
    .bail()
    .matches(/^\+\d{6,15}$/).withMessage('phoneNumber must be in E.164 format (e.g. +9655xxxxxxx)'),
  body('email')
    .if(body('method').equals('email'))
    .isEmail().withMessage('Valid email is required'),
];

/* -------------------------------------------------
   @desc   Send OTP (SMS via Verify, Email via SendGrid Template)
   @route  POST /api/auth/send-otp
   @access Public
-------------------------------------------------- */
router.post('/send-otp', sendOtpValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { phoneNumber, email, method = 'phone' } = req.body;

    if (method === 'phone') {
      // SMS عبر Twilio Verify
      const verification = await twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verifications
        .create({ to: phoneNumber, channel: 'sms' });

      return res.status(200).json({
        success: true,
        message: 'OTP sent via SMS',
        sid: verification.sid,
      });
    }

    // ===== Email عبر SendGrid Templateك (NOT Twilio Verify Email) =====
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryTime = Date.now() + 10 * 60 * 1000; // 10 دقائق
    otpStorage.set(email, { otp, expiryTime });

    const msg = {
      to: email,
      from: process.env.EMAIL_FROM || 'admin@modern-bns.com',
      templateId: process.env.SENDGRID_TEMPLATE_ID,
      dynamic_template_data: {
        twilio_code: otp,
        twilio_message: `Your verification code is ${otp}`,
      },
    };

    await sgMail.send(msg);

    return res.status(200).json({
      success: true,
      message: 'OTP sent via Email (SendGrid Template)',
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
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
   @desc   Verify OTP
   @route  POST /api/auth/verify-otp
   @access Public
-------------------------------------------------- */
router.post('/verify-otp', verifyOtpValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { phoneNumber, email, otp, method = 'phone' } = req.body;

    let isValid = false;

    if (method === 'phone') {
      // تحقق عبر Twilio Verify
      const check = await twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks
        .create({ to: phoneNumber, code: otp });

      isValid = check.status === 'approved';
    } else {
      // تحقق من OTP المخزن (SendGrid Template flow)
      const rec = otpStorage.get(email);
      if (rec && rec.otp === otp && Date.now() < rec.expiryTime) {
        isValid = true;
        otpStorage.delete(email); // احذف الكود بعد النجاح
      }
    }

    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // ✅ OTP صحيح: أنشئ/حدّث المستخدم
    const query = [];
    if (phoneNumber) query.push({ phone: phoneNumber });
    if (email) query.push({ email });

    let user = await User.findOne({ $or: query });

    if (!user) {
      user = await User.create({
        phone: phoneNumber || undefined,
        email: email || undefined,
        name: `User_${Date.now()}`,
        password: crypto.randomBytes(12).toString('hex'),
        isVerified: true,
      });
    } else {
      user.isVerified = true;
      await user.save();
    }

    const token = getSignedJwtToken(user._id);

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error('❌ Verify OTP error:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP: ' + error.message });
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

module.exports = router;
