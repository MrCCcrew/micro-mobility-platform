const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Ride = require('../models/Ride');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, 'uploads/profiles/');
  },
  filename: function(req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function(req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    // Get user statistics
    const stats = await Ride.aggregate([
      { $match: { user: req.user._id, status: 'completed' } },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalDistance: { $sum: '$distance' },
          totalSpent: { $sum: '$cost.total' },
          averageRideDistance: { $avg: '$distance' },
          averageRideDuration: { $avg: '$duration' }
        }
      }
    ]);

    const userStats = stats[0] || {
      totalRides: 0,
      totalDistance: 0,
      totalSpent: 0,
      averageRideDistance: 0,
      averageRideDuration: 0
    };

    res.status(200).json({
      success: true,
      data: {
        ...user.toObject(),
        stats: userStats
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user profile'
    });
  }
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
router.put('/profile', protect, [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2-50 characters'),
  body('phone').optional().isMobilePhone().withMessage('Please enter a valid phone number'),
  body('preferences.language').optional().isIn(['en', 'ar', 'fr', 'es']).withMessage('Invalid language'),
  body('preferences.currency').optional().isIn(['USD', 'EUR', 'EGP', 'SAR', 'AED', 'GBP']).withMessage('Invalid currency')
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

    const updateData = {};
    const { name, phone, preferences } = req.body;

    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (preferences) {
      updateData.preferences = { ...req.user.preferences, ...preferences };
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already exists'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// @desc    Upload profile image
// @route   POST /api/users/profile/image
// @access  Private
router.post('/profile/image', protect, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const imageUrl = `/uploads/profiles/${req.file.filename}`;
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { profileImage: imageUrl },
      { new: true }
    ).select('-password');

    res.status(200).json({
      success: true,
      message: 'Profile image updated successfully',
      data: {
        profileImage: user.profileImage
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile image'
    });
  }
});

// @desc    Update notification preferences
// @route   PUT /api/users/notifications
// @access  Private
router.put('/notifications', protect, [
  body('push').optional().isBoolean().withMessage('Push notifications must be boolean'),
  body('email').optional().isBoolean().withMessage('Email notifications must be boolean'),
  body('sms').optional().isBoolean().withMessage('SMS notifications must be boolean')
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

    const { push, email, sms } = req.body;
    const updateData = {};

    if (push !== undefined) updateData['preferences.notifications.push'] = push;
    if (email !== undefined) updateData['preferences.notifications.email'] = email;
    if (sms !== undefined) updateData['preferences.notifications.sms'] = sms;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true }
    ).select('preferences.notifications');

    res.status(200).json({
      success: true,
      message: 'Notification preferences updated',
      data: user.preferences.notifications
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification preferences'
    });
  }
});

// @desc    Add payment method
// @route   POST /api/users/payment-methods
// @access  Private
router.post('/payment-methods', protect, [
  body('type').isIn(['card', 'wallet']).withMessage('Invalid payment method type'),
  body('provider').notEmpty().withMessage('Provider is required'),
  body('last4').optional().isLength({ min: 4, max: 4 }).withMessage('Last 4 digits must be 4 characters'),
  body('brand').optional().notEmpty().withMessage('Brand is required for card'),
  body('expiryMonth').optional().isInt({ min: 1, max: 12 }).withMessage('Invalid expiry month'),
  body('expiryYear').optional().isInt({ min: new Date().getFullYear() }).withMessage('Invalid expiry year')
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
    const newPaymentMethod = {
      ...req.body,
      isDefault: user.paymentMethods.length === 0 // First method is default
    };

    user.paymentMethods.push(newPaymentMethod);
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Payment method added successfully',
      data: newPaymentMethod
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to add payment method'
    });
  }
});

// @desc    Remove payment method
// @route   DELETE /api/users/payment-methods/:methodId
// @access  Private
router.delete('/payment-methods/:methodId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const method = user.paymentMethods.id(req.params.methodId);

    if (!method) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }

    user.paymentMethods.pull(req.params.methodId);

    // If this was the default and there are other methods, make the first one default
    if (method.isDefault && user.paymentMethods.length > 0) {
      user.paymentMethods[0].isDefault = true;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Payment method removed successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove payment method'
    });
  }
});

// @desc    Set default payment method
// @route   PUT /api/users/payment-methods/:methodId/default
// @access  Private
router.put('/payment-methods/:methodId/default', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const method = user.paymentMethods.id(req.params.methodId);

    if (!method) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }

    // Set all methods to non-default
    user.paymentMethods.forEach(m => m.isDefault = false);
    // Set selected method as default
    method.isDefault = true;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Default payment method updated'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update default payment method'
    });
  }
});

// @desc    Get user ride history
// @route   GET /api/users/rides
// @access  Private
router.get('/rides', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { user: req.user.id };
    if (req.query.status) {
      query.status = req.query.status;
    }

    const rides = await Ride.find(query)
      .populate('vehicle', 'vehicleId type model brand images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Ride.countDocuments(query);

    res.status(200).json({
      success: true,
      count: rides.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: rides
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ride history'
    });
  }
});

// @desc    Delete user account
// @route   DELETE /api/users/account
// @access  Private
router.delete('/account', protect, [
  body('password').notEmpty().withMessage('Password is required to delete account'),
  body('confirmDelete').equals('DELETE').withMessage('Please type DELETE to confirm')
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

    const user = await User.findById(req.user.id).select('+password');
    const { password } = req.body;

    // Verify password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Incorrect password'
      });
    }

    // Check for active rides
    const activeRide = await Ride.findOne({
      user: req.user.id,
      status: 'active'
    });

    if (activeRide) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete account with active rides. Please end your current ride first.'
      });
    }

    // Soft delete - deactivate account instead of hard delete
    user.isActive = false;
    user.email = `deleted_${Date.now()}_${user.email}`;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Account deactivated successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete account'
    });
  }
});

module.exports = router;
