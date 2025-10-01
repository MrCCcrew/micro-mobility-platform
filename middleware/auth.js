// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');

// توليد توكن JWT
function getSignedJwtToken(userId) {
  const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
  const expiresIn = process.env.JWT_EXPIRE || '30d';

  return jwt.sign({ id: userId }, secret, { expiresIn });
}

// حماية المسارات الخاصة
async function protect(req, res, next) {
  try {
    let token;

    // توقّع "Authorization: Bearer <token>"
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    // تحقق من التوكن
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');

    // اجلب المستخدم من جدول User أولاً
    let user = await User.findById(decoded.id);
    
    // إذا لم يوجد في جدول User، ابحث في جدول Admin
    if (!user) {
      user = await Admin.findById(decoded.id);
    }
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }

    // حالات الحساب
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact support.' });
    }
    if (user.isBanned) {
      return res.status(403).json({ success: false, message: `Account is banned: ${user.banReason || 'Contact support'}` });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Protect error:', err.message);
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }
}
function authorize(...allowedRoles) {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
      }
      // لو ما فيش role، اعتبره "user" افتراضيًا (حسب نظامك)
      const role = req.user.role || 'user';
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: insufficient role',
        });
      }
      next();
    } catch (err) {
      console.error('Authorize error:', err.message);
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }
  };
}

module.exports = {
  protect,
  authorize,
  getSignedJwtToken,
};
