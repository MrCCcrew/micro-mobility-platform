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
  
      console.log('📧 Sending email OTP via SendGrid to:', email);
      console.log('📧 Generated OTP:', otp);

      // إرسال الإيميل عبر SendGrid Template
      const msg = {
        to: email,
        from: process.env.EMAIL_FROM || 'admin@modern-bns.com',
        templateId: process.env.SENDGRID_TEMPLATE_ID,
        dynamic_template_data: {
          twilio_code: otp,
          twilio_message: `رمز التحقق الخاص بك هو: ${otp}`,
          otp: otp,
          code: otp,
          email: email
        },
      };

      try {
        await sgMail.send(msg);
        console.log('✅ Email sent successfully via SendGrid');
        return res.status(200).json({
          success: true,
          message: 'OTP sent via email',
          // في بيئة التطوير فقط، أرسل OTP للاختبار
          devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
        });
      } catch (sendGridError) {
        console.error('❌ SendGrid error details:', {
          message: sendGridError.message,
          code: sendGridError.code,
          response: sendGridError.response?.body
        });
        return res.status(500).json({
          success: false,
          message: 'Failed to send email OTP via SendGrid',
        });
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
    console.log('🔐 Verify OTP Request received:', req.body);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', errors.array());
      return res.status(400).json({ 
        success: false, 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const { phoneNumber, email, otp, method = 'phone' } = req.body;
    
    console.log('🔐 Verify OTP Request:', { method, phoneNumber, email: email ? 'provided' : 'not provided', otp: otp ? 'provided' : 'missing' });

    let isValid = false;

    if (method === 'phone') {
      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is required for SMS verification'
        });
      }

      console.log('📱 Verifying SMS OTP for:', phoneNumber);
      
      try {
        const check = await twilioClient.verify.v2
          .services(process.env.TWILIO_VERIFY_SERVICE_SID)
          .verificationChecks
          .create({ to: phoneNumber, code: otp });

        isValid = check.status === 'approved';
        console.log('📱 SMS verification result:', isValid);
      } catch (twilioError) {
        console.error('❌ Twilio SMS verification error:', twilioError);
        return res.status(400).json({
          success: false,
          message: 'Failed to verify SMS OTP: ' + twilioError.message
        });
      }
      
    } else if (method === 'email') {
      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required for email verification'
        });
      }

      console.log('📧 Verifying email OTP via Twilio for:', email);
      
      try {
        const check = await twilioClient.verify.v2
          .services(process.env.TWILIO_VERIFY_SERVICE_SID)
          .verificationChecks
          .create({ to: email, code: otp });

        isValid = check.status === 'approved';
        console.log('📧 Email verification result:', isValid);
      } catch (twilioError) {
        console.error('❌ Twilio email verification error:', twilioError);
        return res.status(400).json({
          success: false,
          message: 'Failed to verify email OTP: ' + twilioError.message
        });
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
      // إنشاء مستخدم جديد
      const userData = {
        name: `User_${Date.now()}`,
        password: crypto.randomBytes(12).toString('hex'),
        isVerified: true,
      };

      // إضافة البيانات حسب الطريقة
      if (method === 'phone' && phoneNumber) {
        userData.phone = phoneNumber;
      } else if (method === 'email' && email) {
        userData.email = email;
        // إنشاء رقم هاتف مؤقت للمستخدمين الذين يسجلون بالبريد الإلكتروني فقط
        userData.phone = `+temp${Date.now()}`;
      }

      user = await User.create(userData);
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
// @desc    Activate account via email link
// @route   GET /api/auth/activate
// @access  Public
router.get('/activate', async (req, res) => {
  try {
    const { email, code } = req.query;

    if (!email || !code) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>خطأ في التفعيل</title>
            <style>
              body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
                padding: 20px;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 20px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 400px;
                width: 100%;
              }
              .error-icon {
                font-size: 64px;
                margin-bottom: 20px;
              }
              h2 {
                color: #e74c3c;
                margin-bottom: 15px;
                font-size: 24px;
              }
              p {
                color: #666;
                line-height: 1.6;
                margin-bottom: 30px;
              }
              .back-button {
                background: #3498db;
                color: white;
                border: none;
                padding: 12px 30px;
                border-radius: 25px;
                font-size: 16px;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                transition: background 0.3s;
              }
              .back-button:hover {
                background: #2980b9;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="error-icon">❌</div>
              <h2>رابط التفعيل غير صحيح</h2>
              <p>يرجى التحقق من الرابط والمحاولة مرة أخرى، أو طلب رمز تفعيل جديد من التطبيق</p>
              <a href="#" class="back-button" onclick="window.close()">إغلاق النافذة</a>
            </div>
          </body>
        </html>
      `);
    }

    // التحقق من OTP المخزن
    const rec = otpStorage.get(email);
    if (!rec || rec.otp !== code || Date.now() > rec.expiryTime) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>انتهت صلاحية الرابط</title>
            <style>
              body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
                padding: 20px;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 20px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 400px;
                width: 100%;
              }
              .warning-icon {
                font-size: 64px;
                margin-bottom: 20px;
              }
              h2 {
                color: #f39c12;
                margin-bottom: 15px;
                font-size: 24px;
              }
              p {
                color: #666;
                line-height: 1.6;
                margin-bottom: 30px;
              }
              .retry-button {
                background: #f39c12;
                color: white;
                border: none;
                padding: 12px 30px;
                border-radius: 25px;
                font-size: 16px;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                transition: background 0.3s;
              }
              .retry-button:hover {
                background: #e67e22;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="warning-icon">⏰</div>
              <h2>انتهت صلاحية رابط التفعيل</h2>
              <p>انتهت صلاحية رابط التفعيل. يرجى فتح التطبيق وطلب رمز تفعيل جديد</p>
              <a href="#" class="retry-button" onclick="window.close()">إغلاق النافذة</a>
            </div>
          </body>
        </html>
      `);
    }

    // حذف OTP بعد النجاح
    otpStorage.delete(email);

    // البحث عن المستخدم أو إنشاؤه
    let user = await User.findOne({ email });
    
    if (!user) {
      user = await User.create({
        email: email,
        phone: `+temp${Date.now()}`, // رقم مؤقت لتجنب خطأ التحقق
        name: `User_${Date.now()}`,
        password: crypto.randomBytes(12).toString('hex'),
        isVerified: true,
      });
    } else {
      user.isVerified = true;
      await user.save();
    }

    // توليد JWT
    const token = getSignedJwtToken(user._id);
    const deepLinkScheme = process.env.APP_DEEP_LINK_SCHEME || 'com.anonymous.ctscooter';

    // عرض صفحة التفعيل التفاعلية
    res.send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>تم تفعيل الحساب بنجاح</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            
            .activation-container {
              background: white;
              padding: 40px;
              border-radius: 20px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.15);
              text-align: center;
              max-width: 450px;
              width: 100%;
              position: relative;
              overflow: hidden;
            }
            
            .activation-container::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              height: 5px;
              background: linear-gradient(90deg, #4CAF50, #45a049);
            }
            
            .success-animation {
              width: 80px;
              height: 80px;
              margin: 0 auto 30px;
              background: linear-gradient(135deg, #4CAF50, #45a049);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 40px;
              color: white;
              animation: bounce 0.6s ease-out;
            }
            
            @keyframes bounce {
              0% { transform: scale(0); }
              50% { transform: scale(1.1); }
              100% { transform: scale(1); }
            }
            
            .title {
              color: #2c3e50;
              font-size: 28px;
              font-weight: bold;
              margin-bottom: 15px;
            }
            
            .subtitle {
              color: #7f8c8d;
              font-size: 16px;
              line-height: 1.6;
              margin-bottom: 30px;
            }
            
            .user-info {
              background: #f8f9fa;
              padding: 20px;
              border-radius: 10px;
              margin-bottom: 30px;
              border-left: 4px solid #4CAF50;
            }
            
            .user-email {
              color: #2c3e50;
              font-weight: 600;
              font-size: 16px;
            }
            
            .steps-container {
              text-align: right;
              margin-bottom: 30px;
            }
            
            .step {
              display: flex;
              align-items: center;
              margin-bottom: 15px;
              padding: 10px;
              background: #f8f9fa;
              border-radius: 8px;
            }
            
            .step-number {
              background: #4CAF50;
              color: white;
              width: 25px;
              height: 25px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 12px;
              font-weight: bold;
              margin-left: 15px;
              flex-shrink: 0;
            }
            
            .step-text {
              color: #2c3e50;
              font-size: 14px;
            }
            
            .open-app-button {
              background: linear-gradient(135deg, #4CAF50, #45a049);
              color: white;
              border: none;
              padding: 18px 40px;
              font-size: 18px;
              font-weight: bold;
              border-radius: 50px;
              cursor: pointer;
              width: 100%;
              margin-bottom: 20px;
              transition: all 0.3s ease;
              box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
            }
            
            .open-app-button:hover {
              transform: translateY(-2px);
              box-shadow: 0 6px 20px rgba(76, 175, 80, 0.4);
            }
            
            .open-app-button:active {
              transform: translateY(0);
            }
            
            .status-message {
              background: #e8f5e8;
              color: #2e7d32;
              padding: 15px;
              border-radius: 8px;
              margin-top: 20px;
              font-size: 14px;
              display: none;
            }
            
            .help-text {
              color: #95a5a6;
              font-size: 13px;
              line-height: 1.5;
              margin-top: 20px;
            }
            
            .loading-spinner {
              display: none;
              width: 20px;
              height: 20px;
              border: 2px solid #ffffff;
              border-top: 2px solid transparent;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin-right: 10px;
            }
            
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            
            .countdown {
              color: #4CAF50;
              font-weight: bold;
              font-size: 18px;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="activation-container">
            <div class="success-animation">✅</div>
            
            <h1 class="title">تم تفعيل حسابك بنجاح!</h1>
            <p class="subtitle">مرحباً بك في تطبيق CTScooter. حسابك الآن جاهز للاستخدام</p>
            
            <div class="user-info">
              <div class="user-email">${email}</div>
            </div>
            
            <div class="steps-container">
              <div class="step">
                <div class="step-number">1</div>
                <div class="step-text">تم التحقق من بريدك الإلكتروني بنجاح</div>
              </div>
              <div class="step">
                <div class="step-number">2</div>
                <div class="step-text">تم إنشاء حسابك وتفعيله</div>
              </div>
              <div class="step">
                <div class="step-number">3</div>
                <div class="step-text">اضغط على الزر أدناه لفتح التطبيق</div>
              </div>
            </div>
            
            <div class="countdown" id="countdown">سيتم فتح التطبيق تلقائياً خلال <span id="timer">5</span> ثوانٍ</div>
            
            <button class="open-app-button" onclick="openApp()" id="openButton">
              <div class="loading-spinner" id="spinner"></div>
              🚀 فتح التطبيق الآن
            </button>
            
            <div class="status-message" id="statusMessage">
              جاري محاولة فتح التطبيق...
            </div>
            
            <p class="help-text">
              إذا لم يفتح التطبيق تلقائياً، تأكد من تثبيت التطبيق على جهازك أو افتحه يدوياً
            </p>
          </div>

          <script>
            let countdownTimer = 5;
            let countdownInterval;
            
            function updateCountdown() {
              const timerElement = document.getElementById('timer');
              const countdownElement = document.getElementById('countdown');
              
              if (countdownTimer > 0) {
                timerElement.textContent = countdownTimer;
                countdownTimer--;
              } else {
                clearInterval(countdownInterval);
                countdownElement.style.display = 'none';
                openApp();
              }
            }
            
            function openApp() {
              const button = document.getElementById('openButton');
              const spinner = document.getElementById('spinner');
              const statusMessage = document.getElementById('statusMessage');
              const countdownElement = document.getElementById('countdown');
              
              // إيقاف العد التنازلي
              clearInterval(countdownInterval);
              countdownElement.style.display = 'none';
              
              // إظهار حالة التحميل
              spinner.style.display = 'inline-block';
              button.innerHTML = '<div class="loading-spinner"></div>جاري فتح التطبيق...';
              button.disabled = true;
              statusMessage.style.display = 'block';
              
              // محاولة فتح التطبيق
              const deepLink = '${deepLinkScheme}://auth?token=${token}';
              console.log('Attempting to open:', deepLink);
              
              // محاولة فتح التطبيق
              window.location.href = deepLink;
              
              // إظهار رسالة نجاح بعد ثانيتين
              setTimeout(() => {
                statusMessage.innerHTML = '✅ تم إرسال الطلب لفتح التطبيق بنجاح!';
                statusMessage.style.background = '#e8f5e8';
                statusMessage.style.color = '#2e7d32';
                
                button.innerHTML = '✅ تم إرسال الطلب';
                button.style.background = '#4CAF50';
                
                // إعادة تعيين الزر بعد 3 ثوانٍ
                setTimeout(() => {
                  button.innerHTML = '🔄 إعادة المحاولة';
                  button.disabled = false;
                  button.style.background = 'linear-gradient(135deg, #4CAF50, #45a049)';
                }, 3000);
              }, 2000);
            }
            
            // بدء العد التنازلي
            countdownInterval = setInterval(updateCountdown, 1000);
            
            // محاولة فتح التطبيق عند تحميل الصفحة (بعد 5 ثوانٍ)
            // setTimeout(openApp, 5000);
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Activation error:', error);
    res.status(500).send(`
      <html>
        <head><title>خطأ في الخادم</title></head>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2>حدث خطأ في الخادم</h2>
          <p>نعتذر، حدث خطأ أثناء معالجة طلبك. يرجى المحاولة مرة أخرى لاحقاً</p>
        </body>
      </html>
    `);
  }
});

module.exports = router;
