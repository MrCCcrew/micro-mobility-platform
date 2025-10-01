const express = require('express');
const crypto = require('crypto');
const Ride = require('../models/User');
const User = require('../models/User');

const router = express.Router();

// التحقق من صحة PayPal Webhook
function verifyPayPalWebhook(req, res, next) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const headers = req.headers;
  const body = req.body;

  // PayPal webhook verification headers
  const authAlgo = headers['paypal-auth-algo'];
  const transmission_id = headers['paypal-transmission-id'];
  const cert_id = headers['paypal-cert-id'];
  const transmission_sig = headers['paypal-transmission-sig'];
  const transmission_time = headers['paypal-transmission-time'];

  // في بيئة التطوير، نتجاهل التحقق
  if (process.env.NODE_ENV === 'development') {
    console.log('PayPal Webhook received (development mode)');
    return next();
  }

  // في الإنتاج، يجب التحقق من الـ signature
  // هذا مثال مبسط - في الإنتاج يجب استخدام PayPal SDK للتحقق
  if (!transmission_sig || !cert_id) {
    return res.status(400).json({
      success: false,
      message: 'Invalid PayPal webhook signature'
    });
  }

  next();
}

// @desc    PayPal Webhook Handler
// @route   POST /api/webhooks/paypal
// @access  Public (but verified)
router.post('/', express.raw({type: 'application/json'}), verifyPayPalWebhook, async (req, res) => {
  try {
    const event = JSON.parse(req.body);
    
    console.log('PayPal Webhook Event:', event.event_type);
    console.log('PayPal Event Data:', JSON.stringify(event, null, 2));

    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await handlePaymentCaptureCompleted(event);
        break;
        
      case 'PAYMENT.CAPTURE.DENIED':
        await handlePaymentCaptureDenied(event);
        break;
        
      case 'PAYMENT.CAPTURE.REFUNDED':
        await handlePaymentCaptureRefunded(event);
        break;
        
      case 'CHECKOUT.ORDER.APPROVED':
        await handleOrderApproved(event);
        break;
        
      case 'CHECKOUT.ORDER.COMPLETED':
        await handleOrderCompleted(event);
        break;
        
      default:
        console.log(`Unhandled PayPal event type: ${event.event_type}`);
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('PayPal Webhook Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Webhook processing failed',
      error: error.message 
    });
  }
});

// معالجة اكتمال الدفع
async function handlePaymentCaptureCompleted(event) {
  try {
    const capture = event.resource;
    const orderId = capture.supplementary_data?.related_ids?.order_id;
    
    if (!orderId) {
      console.error('No order ID found in capture event');
      return;
    }

    // البحث عن الرحلة
    const ride = await Ride.findOne({ 'payment.orderId': orderId });
    
    if (!ride) {
      console.error(`Ride not found for PayPal order: ${orderId}`);
      return;
    }

    // تحديث حالة الدفع
    ride.payment.status = 'completed';
    ride.payment.captureId = capture.id;
    ride.payment.paidAt = new Date();
    ride.payment.transactionId = capture.id;

    await ride.save();

    console.log(`Payment completed for ride: ${ride.rideId}`);
  } catch (error) {
    console.error('Error handling payment capture completed:', error);
  }
}

// معالجة رفض الدفع
async function handlePaymentCaptureDenied(event) {
  try {
    const capture = event.resource;
    const orderId = capture.supplementary_data?.related_ids?.order_id;
    
    if (!orderId) return;

    const ride = await Ride.findOne({ 'payment.orderId': orderId });
    
    if (!ride) {
      console.error(`Ride not found for PayPal order: ${orderId}`);
      return;
    }

    // تحديث حالة الدفع
    ride.payment.status = 'failed';
    await ride.save();

    console.log(`Payment denied for ride: ${ride.rideId}`);
  } catch (error) {
    console.error('Error handling payment capture denied:', error);
  }
}

// معالجة استرداد المبلغ
async function handlePaymentCaptureRefunded(event) {
  try {
    const refund = event.resource;
    const captureId = refund.links?.find(link => link.rel === 'up')?.href?.split('/').pop();
    
    if (!captureId) return;

    const ride = await Ride.findOne({ 'payment.captureId': captureId });
    
    if (!ride) {
      console.error(`Ride not found for PayPal capture: ${captureId}`);
      return;
    }

    // تحديث حالة الدفع
    ride.payment.status = 'refunded';
    ride.payment.refundedAt = new Date();
    ride.payment.refundAmount = parseFloat(refund.amount.value);

    await ride.save();

    console.log(`Payment refunded for ride: ${ride.rideId}`);
  } catch (error) {
    console.error('Error handling payment capture refunded:', error);
  }
}

// معالجة موافقة الطلب
async function handleOrderApproved(event) {
  try {
    const order = event.resource;
    
    console.log(`PayPal order approved: ${order.id}`);
    
    // يمكن إضافة منطق إضافي هنا إذا لزم الأمر
  } catch (error) {
    console.error('Error handling order approved:', error);
  }
}

// معالجة اكتمال الطلب
async function handleOrderCompleted(event) {
  try {
    const order = event.resource;
    
    console.log(`PayPal order completed: ${order.id}`);
    
    // يمكن إضافة منطق إضافي هنا إذا لزم الأمر
  } catch (error) {
    console.error('Error handling order completed:', error);
  }
}

module.exports = router;