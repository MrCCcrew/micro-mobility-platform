const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Ride = require('../models/Ride');
const { protect } = require('../middleware/auth');
const paypalService = require('../services/paypalService');

const router = express.Router();

// @desc    Get user's payment methods
// @route   GET /api/payments/methods
// @access  Private
router.get('/methods', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    res.status(200).json({
      success: true,
      data: user.paymentMethods || []
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment methods'
    });
  }
});

// @desc    Add PayPal as payment method
// @route   POST /api/payments/methods
// @access  Private
router.post('/methods', protect, [
  body('type').isIn(['paypal']).withMessage('Invalid payment method type'),
  body('email').isEmail().withMessage('Valid PayPal email is required')
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

    const { type, email } = req.body;
    const user = await User.findById(req.user.id);

    // إضافة PayPal كطريقة دفع
    const paymentMethod = {
      provider: 'paypal',
      email: email,
      isDefault: user.paymentMethods.length === 0
    };

    user.paymentMethods.push(paymentMethod);
    await user.save();

    res.status(201).json({
      success: true,
      message: 'PayPal payment method added successfully',
      data: paymentMethod
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to add payment method'
    });
  }
});

// @desc    Create PayPal payment for ride
// @route   POST /api/payments/create
// @access  Private
router.post('/create', protect, [
  body('rideId').notEmpty().withMessage('Ride ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Valid amount is required')
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

    const { rideId, amount } = req.body;
    const ride = await Ride.findById(rideId);

    if (!ride || ride.user.toString() !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    // إنشاء طلب دفع PayPal
    const paymentResult = await paypalService.createPayment(
      amount,
      'USD',
      `Payment for ride ${ride.rideId}`
    );

    if (!paymentResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to create PayPal payment',
        error: paymentResult.error
      });
    }

    // تحديث معلومات الدفع في الرحلة
    ride.payment = {
      ...ride.payment,
      provider: 'paypal',
      orderId: paymentResult.orderId,
      status: 'pending',
      amount: amount
    };

    await ride.save();

    res.status(200).json({
      success: true,
      message: 'PayPal payment created successfully',
      data: {
        orderId: paymentResult.orderId,
        approvalUrl: paymentResult.approvalUrl
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Payment processing failed'
    });
  }
});

// @desc    Capture PayPal payment
// @route   POST /api/payments/capture
// @access  Private
router.post('/capture', protect, [
  body('orderId').notEmpty().withMessage('Order ID is required')
], async (req, res) => {
  try {
    const { orderId } = req.body;
    
    // البحث عن الرحلة بواسطة orderId
    const ride = await Ride.findOne({ 'payment.orderId': orderId });
    
    if (!ride || ride.user.toString() !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // تأكيد الدفع مع PayPal
    const captureResult = await paypalService.capturePayment(orderId);

    if (!captureResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to capture PayPal payment',
        error: captureResult.error
      });
    }

    // تحديث حالة الدفع
    ride.payment.status = 'completed';
    ride.payment.captureId = captureResult.captureId;
    ride.payment.paidAt = new Date();

    await ride.save();

    res.status(200).json({
      success: true,
      message: 'Payment completed successfully',
      data: {
        captureId: captureResult.captureId,
        status: captureResult.status
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Payment capture failed'
    });
  }
});

// @desc    PayPal success callback
// @route   GET /api/payments/paypal/success
// @access  Public
router.get('/paypal/success', async (req, res) => {
  const { token } = req.query;
  
  // إعادة توجيه للتطبيق مع رمز النجاح
  res.redirect(`${process.env.DOMAIN}/payment-success?token=${token}`);
});

// @desc    PayPal cancel callback
// @route   GET /api/payments/paypal/cancel
// @access  Public
router.get('/paypal/cancel', async (req, res) => {
  // إعادة توجيه للتطبيق مع رسالة الإلغاء
  res.redirect(`${process.env.DOMAIN}/payment-cancelled`);
});

// @desc    Set default payment method
// @route   PUT /api/payments/methods/:id/default
// @access  Private
router.put('/methods/:id/default', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const methodIndex = user.paymentMethods.findIndex(
      method => method._id.toString() === req.params.id
    );

    if (methodIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }

    // إزالة الافتراضي من جميع الطرق
    user.paymentMethods.forEach(method => {
      method.isDefault = false;
    });

    // تعيين الطريقة الجديدة كافتراضية
    user.paymentMethods[methodIndex].isDefault = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Default payment method updated',
      data: user.paymentMethods
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update default payment method'
    });
  }
});

// @desc    Remove payment method
// @route   DELETE /api/payments/methods/:id
// @access  Private
router.delete('/methods/:id', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const methodIndex = user.paymentMethods.findIndex(
      method => method._id.toString() === req.params.id
    );

    if (methodIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }

    const removedMethod = user.paymentMethods[methodIndex];
    user.paymentMethods.splice(methodIndex, 1);

    // إذا كانت الطريقة المحذوفة افتراضية، اجعل الأولى افتراضية
    if (removedMethod.isDefault && user.paymentMethods.length > 0) {
      user.paymentMethods[0].isDefault = true;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Payment method removed successfully',
      data: user.paymentMethods
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove payment method'
    });
  }
});

// @desc    Get payment history
// @route   GET /api/payments/history
// @access  Private
router.get('/history', protect, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const payments = await Ride.find({ 
      user: req.user.id,
      status: 'completed',
      'cost.total': { $gt: 0 }
    })
    .select('startTime endTime cost distance duration vehicle')
    .populate('vehicle', 'identifier type')
    .sort({ endTime: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    const total = await Ride.countDocuments({ 
      user: req.user.id,
      status: 'completed',
      'cost.total': { $gt: 0 }
    });

    res.status(200).json({
      success: true,
      data: payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history'
    });
  }
});

module.exports = router;
