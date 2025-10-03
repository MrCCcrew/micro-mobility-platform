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

const completeProfileValidation = [
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
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
      from: process.env.EMAIL_FROM || 'no-reply@example.com',
      templateId: process.env.SENDGRID_TEMPLATE_ID, // لازم يكون d-...
      dynamic_template_data: {
        // ✅ نفس أسماء المتغيرات الموجودة في القالب بتاعك:
        twilio_code: otp,
        twilio_message: `Your verification code is ${otp}`,
        // تقدر تضيف أي حقول تانية لو القالب بيستخدمها
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

    // تحقق من عدم وجود إيميل مكرر (إذا كان مختلف عن الإيميل الحالي)
    if (email && email !== user.email) {
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
    }

    // تحديث بيانات المستخدم الحالي
    user.name = `${firstName} ${lastName}`;
    if (email) {
      user.email = email;
    }
    
    // التأكد من أن رقم الهاتف موجود (يجب أن يكون موجود من مرحلة التحقق من OTP)
    if (!user.phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is missing. Please verify your phone number again.' 
      });
    }

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

    // البحث عن الأدمن
    const admin = await Admin.findOne({ email }).select('+password');
    if (!admin) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // التحقق من كلمة المرور
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }

    // إنشاء التوكن
    const token = getSignedJwtToken(admin._id);

    res.status(200).json({
      success: true,
      message: 'Admin login successful',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });

  } catch (error) {
    console.error('❌ Admin login error:', error);
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
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('❌ Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update user profile
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

    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields if provided
    if (req.body.name) user.name = req.body.name;
    if (req.body.phone) user.phone = req.body.phone;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('❌ Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
