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
    
    console.log('📧 Send OTP Request:', { method, phoneNumber, email: email ? 'provided' : 'not provided' });

    if (method === 'phone') {
      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is required'
        });
      }

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

    } else if (method === 'email') {
      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      // إنشاء OTP عشوائي للإيميل
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiryTime = Date.now() + 10 * 60 * 1000; // 10 دقائق

      // حفظ OTP في الذاكرة المؤقتة
      otpStorage.set(email, { otp, expiryTime });

      // إرسال الإيميل عبر SendGrid Template
      const msg = {
        to: email,
        from: process.env.EMAIL_FROM,
        templateId: process.env.SENDGRID_TEMPLATE_ID,
        dynamicTemplateData: {
          otp: otp,
          email: email,
        },
      };

      console.log('📧 Attempting to send email to:', email);
      console.log('📱 Phone number available for fallback:', phoneNumber ? 'Yes' : 'No');

      try {
        await sgMail.send(msg);
        console.log('✅ Email sent successfully');
        return res.status(200).json({
          success: true,
          message: 'OTP sent via email',
        });
      } catch (sendGridError) {
        console.error('❌ SendGrid error:', sendGridError);
        console.log('🔄 Checking fallback options...');
        
        // في حالة فشل SendGrid، نستخدم SMS كبديل إذا كان رقم الهاتف متوفر
        if (phoneNumber) {
          console.log('📱 Phone number found, falling back to SMS:', phoneNumber);
          
          try {
            // حذف OTP المخزن للإيميل لأننا سنستخدم Twilio بدلاً منه
            otpStorage.delete(email);
            
            const verification = await twilioClient.verify.v2
              .services(process.env.TWILIO_VERIFY_SERVICE_SID)
              .verifications
              .create({ to: phoneNumber, channel: 'sms' });

            console.log('✅ SMS fallback successful');
            return res.status(200).json({
              success: true,
              message: 'Email service unavailable. OTP sent via SMS instead.',
              sid: verification.sid,
              fallbackToSms: true,
            });
          } catch (twilioError) {
            console.error('❌ Twilio fallback error:', twilioError);
            return res.status(500).json({
              success: false,
              message: 'Both email and SMS services failed',
            });
          }
        } else {
          console.log('❌ No phone number available for fallback');
          return res.status(500).json({
            success: false,
            message: 'Email service unavailable and no phone number provided for fallback',
          });
        }
      }
    }

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

    const { phoneNumber, email, otp, method = 'phone', fallbackToSms } = req.body;
    
    console.log('🔐 Verify OTP Request:', { method, phoneNumber, email: email ? 'provided' : 'not provided', fallbackToSms });

    let isValid = false;

    if (method === 'phone' || fallbackToSms) {
      // تحقق عبر Twilio Verify
      const targetPhone = phoneNumber;
      
      if (!targetPhone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is required for SMS verification'
        });
      }

      console.log('📱 Verifying SMS OTP for:', targetPhone);
      
      const check = await twilioClient.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks
        .create({ to: targetPhone, code: otp });

      isValid = check.status === 'approved';
      console.log('📱 SMS verification result:', isValid);
      
    } else if (method === 'email') {
      // تحقق من OTP المخزن (SendGrid Template flow)
      console.log('📧 Verifying email OTP for:', email);
      
      const rec = otpStorage.get(email);
      if (rec && rec.otp === otp && Date.now() < rec.expiryTime) {
        isValid = true;
        otpStorage.delete(email); // احذف الكود بعد النجاح
        console.log('📧 Email verification successful');
      } else {
        console.log('📧 Email verification failed - invalid or expired OTP');
      }
    }

    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // ✅ OTP صحيح: أنشئ/حدّث المستخدم
    const query = [];
    if (phoneNumber) query.push({ phone: phoneNumber });
    if (email) query.push({ email });

    console.log('🔍 Searching for user with query:', query);

    try {
      // استخدام timeout أقصر وإعدادات أكثر صرامة
      let user = await User.findOne({ $or: query })
        .maxTimeMS(5000) // 5 ثوانٍ فقط
        .lean(); // استخدام lean للحصول على أداء أفضل

      if (!user) {
        console.log('👤 Creating new user...');
        user = await User.create({
          phone: phoneNumber || undefined,
          email: email || undefined,
          name: `User_${Date.now()}`,
          password: crypto.randomBytes(12).toString('hex'),
          isVerified: true,
        });
        console.log('✅ New user created:', user._id);
      } else {
        console.log('👤 User found, updating verification status...');
        // بدلاً من save(), استخدم updateOne للأداء الأفضل
        await User.updateOne(
          { _id: user._id }, 
          { isVerified: true }
        ).maxTimeMS(3000);
        
        // إعادة جلب البيانات المحدثة
        user = await User.findById(user._id).lean().maxTimeMS(3000);
        console.log('✅ User verification updated:', user._id);
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

    } catch (dbError) {
      console.error('❌ Database operation failed:', dbError.message);
      
      // في حالة فشل قاعدة البيانات، نعيد استجابة مؤقتة
      return res.status(200).json({
        success: true,
        message: 'OTP verified successfully (temporary session)',
        token: 'temp_token_' + Date.now(), // توكن مؤقت
        user: {
          id: 'temp_' + Date.now(),
          name: 'User',
          email: email || null,
          phone: phoneNumber || null,
        },
        warning: 'Database connection issue - using temporary session'
      });
    }
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

// إضافة route جديد لإكمال البيانات
router.post('/complete-profile', async (req, res) => {
  try {
    const {
      phoneNumber,
      email,
      method,
      firstName,
      lastName,
      fullName,
      country,
      province
    } = req.body;

    // التحقق من وجود البيانات المطلوبة
    if (!firstName || !lastName || !country || !province) {
      return res.status(400).json({
        success: false,
        message: 'جميع البيانات مطلوبة'
      });
    }

    // البحث عن المستخدم أو إنشاء مستخدم جديد
    let user = await User.findOne({
      $or: [
        { phoneNumber: phoneNumber },
        { email: email }
      ]
    });

    if (!user) {
      // إنشاء مستخدم جديد
      user = new User({
        phoneNumber,
        email,
        method,
        firstName,
        lastName,
        fullName,
        country,
        province,
        isVerified: true,
        isProfileComplete: true,
        registeredAt: new Date()
      });
    } else {
      // تحديث بيانات المستخدم الموجود
      user.firstName = firstName;
      user.lastName = lastName;
      user.fullName = fullName;
      user.country = country;
      user.province = province;
      user.isProfileComplete = true;
    }

    await user.save();

    res.json({
      success: true,
      message: 'تم حفظ البيانات بنجاح',
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        email: user.email,
        fullName: user.fullName,
        country: user.country,
        province: user.province
      }
    });

  } catch (error) {
    console.error('خطأ في إكمال البيانات:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في الخادم'
    });
  }
});
module.exports = router;
