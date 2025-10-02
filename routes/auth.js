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
  
      // إرسال الإيميل عبر SendGrid Template مع رابط التفعيل
      const activationLink = `${process.env.ACTIVATION_LINK_BASE || 'https://scooters.modern-bns.com'}/api/auth/activate?email=${encodeURIComponent(email)}&code=${otp}`;
      
      const msg = {
        to: email,
        from: process.env.EMAIL_FROM,
        templateId: process.env.SENDGRID_TEMPLATE_ID,
        dynamic_template_data: {
          twilio_code: otp,
          twilio_message: `رمز التحقق الخاص بك هو: ${otp}`,
          otp: otp,
          code: otp,
          email: email,
          activation_link: activationLink
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

    // تبسيط عمليات قاعدة البيانات
    let user = await User.findOne({ $or: query });

    if (!user) {
      console.log('👤 Creating new user...');
      
      // إنشاء بيانات المستخدم بناءً على طريقة التفعيل
      const userData = {
        name: `User_${Date.now()}`,
        password: crypto.randomBytes(12).toString('hex'),
        isVerified: true,
      };

      if (method === 'phone') {
        // التفعيل بالهاتف
        userData.phone = phoneNumber;
      } else if (method === 'email') {
        // التفعيل بالإيميل
        userData.email = email;
        // إنشاء رقم هاتف مؤقت فريد لتجنب خطأ التحقق المطلوب
        userData.phone = `+temp${Date.now()}`;
      }

      user = await User.create(userData);
      console.log('✅ New user created:', user._id);
    } else {
      console.log('👤 User found, updating verification status...');
      user.isVerified = true;
      await user.save();
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
        <html>
          <head><title>خطأ في التفعيل</title></head>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2>رابط التفعيل غير صحيح</h2>
            <p>يرجى التحقق من الرابط والمحاولة مرة أخرى</p>
          </body>
        </html>
      `);
    }

    // التحقق من OTP المخزن
    const rec = otpStorage.get(email);
    if (!rec || rec.otp !== code || Date.now() > rec.expiryTime) {
      return res.status(400).send(`
        <html>
          <head><title>انتهت صلاحية الرابط</title></head>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2>انتهت صلاحية رابط التفعيل</h2>
            <p>يرجى طلب رمز تفعيل جديد من التطبيق</p>
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

    // عرض صفحة النجاح مع زر فتح التطبيق
    res.send(`
      <html>
        <head>
          <title>تم تفعيل الحساب بنجاح</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial; text-align: center; padding: 20px; background: #f5f5f5;">
          <div style="max-width: 400px; margin: 50px auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #4CAF50; margin-bottom: 20px;">✅ تم تفعيل حسابك بنجاح!</h2>
            <p style="color: #666; margin-bottom: 30px;">يمكنك الآن الدخول إلى التطبيق والاستمتاع بخدماتنا</p>
            
            <button onclick="openApp()" style="
              background: #4CAF50; 
              color: white; 
              border: none; 
              padding: 15px 30px; 
              font-size: 16px; 
              border-radius: 5px; 
              cursor: pointer; 
              margin-bottom: 20px;
              width: 100%;
            ">
              🚀 الدخول إلى التطبيق الآن
            </button>
            
            <p style="font-size: 12px; color: #999;">
              إذا لم يفتح التطبيق تلقائياً، يرجى فتحه يدوياً
            </p>
          </div>

          <script>
            function openApp() {
              const deepLink = '${deepLinkScheme}://auth?token=${token}';
              window.location.href = deepLink;
              
              // إظهار رسالة بعد محاولة فتح التطبيق
              setTimeout(() => {
                document.body.innerHTML += '<div style="position: fixed; top: 0; left: 0; right: 0; background: #4CAF50; color: white; padding: 10px; text-align: center;">تم إرسال الطلب لفتح التطبيق...</div>';
              }, 1000);
            }
            
            // محاولة فتح التطبيق تلقائياً عند تحميل الصفحة
            setTimeout(openApp, 2000);
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
          <p>يرجى المحاولة مرة أخرى لاحقاً</p>
        </body>
      </html>
    `);
  }
});

// إزالة هذا الكود بالكامل من نهاية الملف:
// router.get('/activate', async (req, res) => {
// ... كل الكود الخاص بالتفعيل
// });

module.exports = router;
