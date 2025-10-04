const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const paypalService = require('../services/paypalService');
const LocationService = require('../services/locationService');

const router = express.Router();

// @desc    Get wallet balance and transactions
// @route   GET /api/wallet
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user.wallet) {
      user.wallet = {
        balance: 0,
        currency: user.location?.country?.currency || 'EGP',
        transactions: []
      };
      await user.save();
    }

    res.status(200).json({
      success: true,
      data: {
        balance: user.wallet.balance,
        currency: user.wallet.currency,
        currencySymbol: user.location?.country?.symbol || 'ج.م',
        transactions: user.wallet.transactions.slice(-10) // آخر 10 معاملات
      }
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet information'
    });
  }
});

// @desc    Create PayPal payment for wallet top-up
// @route   POST /api/wallet/topup
// @access  Private
router.post('/topup', protect, [
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least 1'),
  body('currency').optional().isIn(['USD', 'EUR', 'EGP', 'SAR', 'AED', 'GBP', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD'])
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

    const { amount } = req.body;
    const user = await User.findById(req.user.id);
    
    // تحديد العملة بناءً على موقع المستخدم
    const currency = req.body.currency || user.location?.country?.currency || 'EGP';
    
    // إنشاء دفعة PayPal
    const paymentResult = await paypalService.createPayment(
      amount,
      currency,
      `Wallet top-up - ${amount} ${currency}`,
      user.location
    );

    if (!paymentResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to create PayPal payment',
        error: paymentResult.error
      });
    }

    // إضافة معاملة معلقة
    const transactionId = `topup_${Date.now()}_${user._id}`;
    user.wallet = user.wallet || { balance: 0, currency, transactions: [] };
    user.wallet.transactions.push({
      id: transactionId,
      type: 'topup',
      amount: amount,
      currency: currency,
      description: `شحن المحفظة - ${amount} ${currency}`,
      paymentMethod: 'paypal',
      paymentId: paymentResult.orderId,
      status: 'pending'
    });

    await user.save();

    res.status(200).json({
      success: true,
      data: {
        orderId: paymentResult.orderId,
        approvalUrl: paymentResult.approvalUrl,
        transactionId: transactionId,
        amount: paymentResult.originalAmount,
        currency: paymentResult.originalCurrency,
        convertedAmount: paymentResult.finalAmount,
        convertedCurrency: paymentResult.finalCurrency
      }
    });

  } catch (error) {
    console.error('Wallet top-up error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process wallet top-up'
    });
  }
});

// @desc    Handle PayPal payment success
// @route   GET /api/wallet/paypal/success
// @access  Public
router.get('/paypal/success', async (req, res) => {
  try {
    const { token: orderId, PayerID } = req.query;

    if (!orderId) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:19006'}?payment=failed`);
    }

    // تأكيد الدفعة
    const captureResult = await paypalService.capturePayment(orderId);

    if (!captureResult.success) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:19006'}?payment=failed`);
    }

    // العثور على المعاملة وتحديثها
    const user = await User.findOne({ 'wallet.transactions.paymentId': orderId });
    
    if (user) {
      const transaction = user.wallet.transactions.find(t => t.paymentId === orderId);
      if (transaction) {
        transaction.status = 'completed';
        
        // إضافة المبلغ للمحفظة
        user.wallet.balance += transaction.amount;
        
        await user.save();
      }
    }

    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:19006'}?payment=success&amount=${captureResult.amount.value}&currency=${captureResult.amount.currency_code}`);

  } catch (error) {
    console.error('PayPal success handler error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:19006'}?payment=failed`);
  }
});

// @desc    Handle PayPal payment cancellation
// @route   GET /api/wallet/paypal/cancel
// @access  Public
router.get('/paypal/cancel', async (req, res) => {
  const { token: orderId } = req.query;

  if (orderId) {
    // تحديث حالة المعاملة إلى ملغية
    const user = await User.findOne({ 'wallet.transactions.paymentId': orderId });
    if (user) {
      const transaction = user.wallet.transactions.find(t => t.paymentId === orderId);
      if (transaction) {
        transaction.status = 'failed';
        await user.save();
      }
    }
  }

  res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:19006'}?payment=cancelled`);
});

// @desc    Update user location and currency
// @route   PUT /api/wallet/location
// @access  Private
router.put('/location', protect, [
  body('latitude').isFloat().withMessage('Valid latitude is required'),
  body('longitude').isFloat().withMessage('Valid longitude is required'),
  body('country').optional().isObject()
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

    const { latitude, longitude, country } = req.body;
    const user = await User.findById(req.user.id);

    // تحديث موقع المستخدم
    user.location = {
      coordinates: { latitude, longitude },
      country: country || user.location?.country,
      lastUpdated: new Date()
    };

    // تحديث عملة المحفظة إذا تغيرت الدولة
    if (country && user.wallet) {
      user.wallet.currency = country.currency;
    }

    await user.save();

    res.status(200).json({
      success: true,
      data: {
        location: user.location,
        walletCurrency: user.wallet?.currency
      }
    });

  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location'
    });
  }
});

// @desc    Get transaction history
// @route   GET /api/wallet/transactions
// @access  Private
router.get('/transactions', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const user = await User.findById(req.user.id);

    if (!user.wallet) {
      return res.status(200).json({
        success: true,
        data: {
          transactions: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            pages: 0
          }
        }
      });
    }

    let transactions = user.wallet.transactions;

    // فلترة حسب النوع
    if (type) {
      transactions = transactions.filter(t => t.type === type);
    }

    // ترتيب حسب التاريخ (الأحدث أولاً)
    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // تطبيق التصفح
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTransactions = transactions.slice(startIndex, endIndex);

    res.status(200).json({
      success: true,
      data: {
        transactions: paginatedTransactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: transactions.length,
          pages: Math.ceil(transactions.length / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction history'
    });
  }
});

module.exports = router;