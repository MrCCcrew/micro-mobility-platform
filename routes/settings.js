const express = require('express');
const { body, validationResult } = require('express-validator');
const Settings = require('../models/Settings');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes require admin access
router.use(protect);
router.use(authorize('admin', 'super_admin'));

// @desc    Get all settings
// @route   GET /api/settings
// @access  Private/Admin
router.get('/', async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings'
    });
  }
});

// @desc    Update all settings
// @route   PUT /api/settings
// @access  Private/Admin
router.put('/', async (req, res) => {
  try {
    const settings = await Settings.updateSettings(req.body);
    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
});

// @desc    Get general settings
// @route   GET /api/settings/general
// @access  Private/Admin
router.get('/general', async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.status(200).json({
      success: true,
      data: settings.general
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch general settings'
    });
  }
});

// @desc    Update general settings
// @route   PUT /api/settings/general
// @access  Private/Admin
router.put('/general', [
  body('siteName').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Site name must be 1-100 characters'),
  body('siteDescription').optional().trim().isLength({ max: 500 }).withMessage('Description must be max 500 characters'),
  body('contactEmail').optional().isEmail().withMessage('Invalid email format'),
  body('timezone').optional().trim().notEmpty().withMessage('Timezone is required'),
  body('language').optional().isIn(['en', 'ar', 'es', 'fr']).withMessage('Invalid language'),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'SAR']).withMessage('Invalid currency')
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

    const settings = await Settings.updateSettings({
      general: req.body
    });

    res.status(200).json({
      success: true,
      data: settings.general
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update general settings'
    });
  }
});

// @desc    Get notification settings
// @route   GET /api/settings/notifications
// @access  Private/Admin
router.get('/notifications', async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.status(200).json({
      success: true,
      data: settings.notifications
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification settings'
    });
  }
});

// @desc    Update notification settings
// @route   PUT /api/settings/notifications
// @access  Private/Admin
router.put('/notifications', async (req, res) => {
  try {
    const settings = await Settings.updateSettings({
      notifications: req.body
    });

    res.status(200).json({
      success: true,
      data: settings.notifications
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification settings'
    });
  }
});

// @desc    Get security settings
// @route   GET /api/settings/security
// @access  Private/Admin
router.get('/security', async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.status(200).json({
      success: true,
      data: settings.security
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch security settings'
    });
  }
});

// @desc    Update security settings
// @route   PUT /api/settings/security
// @access  Private/Admin
router.put('/security', [
  body('passwordMinLength').optional().isInt({ min: 6, max: 20 }).withMessage('Password length must be 6-20'),
  body('sessionTimeout').optional().isInt({ min: 300, max: 86400 }).withMessage('Session timeout must be 5min-24h'),
  body('maxLoginAttempts').optional().isInt({ min: 3, max: 10 }).withMessage('Max attempts must be 3-10'),
  body('lockoutDuration').optional().isInt({ min: 300, max: 3600 }).withMessage('Lockout duration must be 5min-1h')
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

    const settings = await Settings.updateSettings({
      security: req.body
    });

    res.status(200).json({
      success: true,
      data: settings.security
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update security settings'
    });
  }
});

// @desc    Get system settings
// @route   GET /api/settings/system
// @access  Private/Admin
router.get('/system', async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.status(200).json({
      success: true,
      data: settings.system
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system settings'
    });
  }
});

// @desc    Update system settings
// @route   PUT /api/settings/system
// @access  Private/Admin
router.put('/system', async (req, res) => {
  try {
    const settings = await Settings.updateSettings({
      system: req.body
    });

    res.status(200).json({
      success: true,
      data: settings.system
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update system settings'
    });
  }
});

module.exports = router;