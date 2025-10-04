const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const paypalService = require('../services/paypalService');
// const LocationService = require('../services/locationService'); // غير مستخدم حالياً

const router = express.Router();

// ===== Helpers =====
const ALLOWED_CURRENCIES = ['USD','EUR','EGP','SAR','AED','GBP','QAR','KWD','BHD','OMR','JOD'];
const DEFAULTS = { currency: 'EGP', symbol: 'ج.م' };

function pickCurrency(user, reqCurrency) {
  if (reqCurrency && ALLOWED_CURRENCIES.includes(reqCurrency)) return reqCurrency;
  return user?.location?.country?.currency || DEFAULTS.currency;
}
function pickSymbol(user) {
  return user?.location?.country?.symbol || DEFAULTS.symbol;
}
async function ensureWallet(user, currencyHint) {
  if (!user.wallet) {
    user.wallet = {
      balance: 0,
      currency: currencyHint || pickCurrency(user),
      transactions: []
    };
    await user.save();
  } else if (!user.wallet.currency) {
    user.wallet.currency = currencyHint || pickCurrency(user);
    await user.save();
  }
}

// ===== 1) GET /api/wallet =====
router.get('/', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await ensureWallet(user);

    const tx = Array.isArray(user.wallet.transactions) ? user.wallet.transactions : [];
    const last10 = tx
      .slice(-50) // قلل القراءة
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 10);

    return res.status(200).json({
      success: true,
      data: {
        balance: user.wallet.balance,
        currency: user.wallet.currency,
        currencySymbol: pickSymbol(user),
        transactions: last10
      }
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    return res.status(500).json({ success: false, message: 'Failed to get wallet information' });
  }
});

// ===== 2) POST /api/wallet/topup =====
router.post(
  '/topup',
  protect,
  [
    body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least 1'),
    body('currency').optional().isIn(ALLOWED_CURRENCIES).withMessage('Unsupported currency')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { amount, currency: reqCurrency } = req.body;
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const currency = pickCurrency(user, reqCurrency);
      await ensureWallet(user, currency);

      // إنشاء طلب دفع PayPal
      const description = `Wallet top-up - ${amount} ${currency}`;
      const paymentResult = await paypalService.createPayment(amount, currency, description, user.location);

      if (!paymentResult?.success) {
        return res.status(400).json({
          success: false,
          message: 'Failed to create PayPal payment',
          error: paymentResult?.error || 'Unknown error'
        });
      }

      // إضافة معاملة Pending
      const transactionId = `topup_${Date.now()}_${user._id}`;
      user.wallet.transactions = user.wallet.transactions || [];
      user.wallet.transactions.push({
        id: transactionId,
        type: 'topup',
        amount: Number(amount),
        currency,
        description: `شحن المحفظة - ${amount} ${currency}`,
        paymentMethod: 'paypal',
        paymentId: paymentResult.orderId,
        status: 'pending',
        createdAt: new Date()
      });
      await user.save();

      return res.status(200).json({
        success: true,
        data: {
          orderId: paymentResult.orderId,
          approvalUrl: paymentResult.approvalUrl,
          transactionId,
          amount: paymentResult.originalAmount,
          currency: paymentResult.originalCurrency,
          convertedAmount: paymentResult.finalAmount,
          convertedCurrency: paymentResult.finalCurrency
        }
      });
    } catch (error) {
      console.error('Wallet top-up error:', error);
      return res.status(500).json({ success: false, message: 'Failed to process wallet top-up' });
    }
  }
);

// ===== 3) GET /api/wallet/paypal/success =====
router.get('/paypal/success', async (req, res) => {
  try {
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:19006';
    const { token: orderId } = req.query;

    if (!orderId) return res.redirect(`${FRONTEND_URL}?payment=failed`);

    const captureResult = await paypalService.capturePayment(orderId);
    if (!captureResult?.success) return res.redirect(`${FRONTEND_URL}?payment=failed`);

    const user = await User.findOne({ 'wallet.transactions.paymentId': orderId });
    if (user?.wallet?.transactions?.length) {
      const tx = user.wallet.transactions.find(t => t.paymentId === orderId);
      if (tx) {
        tx.status = 'completed';
        tx.updatedAt = new Date();

        // أضف الرصيد
        const amt = Number(tx.amount) || 0;
        user.wallet.balance = Number(user.wallet.balance || 0) + amt;

        await user.save();
      }
    }

    const a = captureResult.amount || {};
    return res.redirect(`${FRONTEND_URL}?payment=success&amount=${a.value || ''}&currency=${a.currency_code || ''}`);
  } catch (error) {
    console.error('PayPal success handler error:', error);
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:19006';
    return res.redirect(`${FRONTEND_URL}?payment=failed`);
  }
});

// ===== 4) GET /api/wallet/paypal/cancel =====
router.get('/paypal/cancel', async (req, res) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:19006';
  try {
    const { token: orderId } = req.query;
    if (orderId) {
      const user = await User.findOne({ 'wallet.transactions.paymentId': orderId });
      if (user?.wallet?.transactions?.length) {
        const tx = user.wallet.transactions.find(t => t.paymentId === orderId);
        if (tx) {
          tx.status = 'failed';
          tx.reason = 'cancelled';
          tx.updatedAt = new Date();
          await user.save();
        }
      }
    }
    return res.redirect(`${FRONTEND_URL}?payment=cancelled`);
  } catch (error) {
    console.error('PayPal cancel handler error:', error);
    return res.redirect(`${FRONTEND_URL}?payment=failed`);
  }
});

// ===== 5) PUT /api/wallet/location =====
router.put(
  '/location',
  protect,
  [
    body('latitude').isFloat().withMessage('Valid latitude is required'),
    body('longitude').isFloat().withMessage('Valid longitude is required'),
    body('country').optional().isObject()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
      }

      const { latitude, longitude, country } = req.body;
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      user.location = {
        coordinates: { latitude: Number(latitude), longitude: Number(longitude) },
        country: country || user.location?.country,
        lastUpdated: new Date()
      };

      // تحديث عملة المحفظة لو الدولة اتغيّرت
      await ensureWallet(user);
      if (country?.currency && user.wallet) {
        user.wallet.currency = country.currency;
      }

      await user.save();
      return res.status(200).json({
        success: true,
        data: { location: user.location, walletCurrency: user.wallet?.currency }
      });
    } catch (error) {
      console.error('Update location error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update location' });
    }
  }
);

// ===== 6) GET /api/wallet/transactions =====
router.get('/transactions', protect, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const { type } = req.query;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await ensureWallet(user);

    let tx = Array.isArray(user.wallet.transactions) ? user.wallet.transactions : [];

    if (type) tx = tx.filter(t => t.type === type);

    tx.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const total = tx.length;
    const start = (page - 1) * limit;
    const paginated = tx.slice(start, start + limit);

    return res.status(200).json({
      success: true,
      data: {
        transactions: paginated,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    return res.status(500).json({ success: false, message: 'Failed to get transaction history' });
  }
});

module.exports = router;
