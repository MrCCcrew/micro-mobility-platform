const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

// Pricing Schema for different services
const defaultPricing = {
  scooter: {
    unlockFee: 1.00,
    perMinute: 0.15,
    currency: 'USD'
  },
  bike: {
    unlockFee: 0.50,
    perMinute: 0.10,
    currency: 'USD'
  },
  ebike: {
    unlockFee: 1.50,
    perMinute: 0.20,
    currency: 'USD'
  }
};

// Currency rates (you can integrate with real-time API later)
const currencyRates = {
  USD: 1.00,
  EUR: 0.85,
  GBP: 0.73,
  SAR: 3.75,
  AED: 3.67,
  EGP: 31.25,
  QAR: 3.64
};

// @route   GET /api/pricing
// @desc    Get current pricing for all vehicles
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { currency = 'USD' } = req.query;
    const rate = currencyRates[currency] || 1;
    
    const pricing = {};
    for (const [type, prices] of Object.entries(defaultPricing)) {
      pricing[type] = {
        unlockFee: (prices.unlockFee * rate).toFixed(2),
        perMinute: (prices.perMinute * rate).toFixed(2),
        currency: currency
      };
    }
    
    res.json({
      success: true,
      pricing,
      currency,
      rate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   PUT /api/pricing
// @desc    Update pricing (Admin only)
// @access  Private/Admin
router.put('/', protect, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    const { vehicleType, unlockFee, perMinute, currency } = req.body;
    
    if (!vehicleType || unlockFee === undefined || perMinute === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle type, unlock fee, and per minute rate are required'
      });
    }

    // Update pricing in memory (in real app, save to database)
    defaultPricing[vehicleType] = {
      unlockFee: parseFloat(unlockFee),
      perMinute: parseFloat(perMinute),
      currency: currency || 'USD'
    };

    res.json({
      success: true,
      message: 'Pricing updated successfully',
      pricing: defaultPricing[vehicleType]
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   POST /api/pricing/calculate
// @desc    Calculate ride cost
// @access  Public
router.post('/calculate', async (req, res) => {
  try {
    const { vehicleType, duration, currency = 'USD' } = req.body;
    
    if (!vehicleType || !duration) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle type and duration are required'
      });
    }

    const pricing = defaultPricing[vehicleType];
    if (!pricing) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle type'
      });
    }

    const rate = currencyRates[currency] || 1;
    const unlockFee = pricing.unlockFee * rate;
    const perMinuteRate = pricing.perMinute * rate;
    const minutes = Math.ceil(duration / 60); // Convert seconds to minutes
    
    const totalCost = unlockFee + (perMinuteRate * minutes);

    res.json({
      success: true,
      calculation: {
        vehicleType,
        duration: duration,
        minutes,
        unlockFee: unlockFee.toFixed(2),
        perMinuteRate: perMinuteRate.toFixed(2),
        totalCost: totalCost.toFixed(2),
        currency
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/pricing/currencies
// @desc    Get supported currencies
// @access  Public
router.get('/currencies', async (req, res) => {
  try {
    res.json({
      success: true,
      currencies: Object.keys(currencyRates),
      rates: currencyRates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;

