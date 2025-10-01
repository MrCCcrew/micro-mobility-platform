const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const Admin = require('../models/Admin');
const Vehicle = require('../models/Vehicle');
const Ride = require('../models/Ride');
const Zone = require('../models/Zone');
const Settings = require('../models/Settings');
const { protect, authorize } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');

const router = express.Router();

// Apply admin protection to all routes
router.use(protect);
router.use(authorize('admin', 'super_admin', 'call_center', 'supervisor', 'viewer'));

// @desc    Get dashboard statistics
// @route   GET /api/admin/dashboard/stats
// @access  Private/Admin
router.get('/dashboard/stats', checkPermission('dashboard', 'view'), async (req, res) => {
  try {
    const [
      totalUsers,
      totalVehicles,
      activeRides,
      todayRides,
      totalRevenue,
      todayRevenue
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      Vehicle.countDocuments(),
      Ride.countDocuments({ status: 'active' }),
      Ride.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      Ride.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$cost.total' } } }
      ]),
      Ride.aggregate([
        {
          $match: {
            status: 'completed',
            createdAt: {
              $gte: new Date(new Date().setHours(0, 0, 0, 0))
            }
          }
        },
        { $group: { _id: null, total: { $sum: '$cost.total' } } }
      ])
    ]);

    // Calculate additional metrics
    const avgRideStats = await Ride.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: null,
          avgDistance: { $avg: '$distance' },
          avgDuration: { $avg: '$duration' },
          totalDistance: { $sum: '$distance' }
        }
      }
    ]);

    const vehicleUtilization = await Vehicle.aggregate([
      {
        $group: {
          _id: null,
          available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } },
          inUse: { $sum: { $cond: [{ $eq: ['$status', 'in_use'] }, 1, 0] } },
          total: { $sum: 1 }
        }
      }
    ]);

    const stats = {
      totalUsers,
      totalVehicles,
      activeRides,
      todayRides,
      totalRevenue: totalRevenue[0]?.total || 0,
      todayRevenue: todayRevenue[0]?.total || 0,
      averageRideDistance: avgRideStats[0]?.avgDistance || 0,
      averageRideDuration: avgRideStats[0]?.avgDuration || 0,
      totalDistance: avgRideStats[0]?.totalDistance || 0,
      vehicleUtilization: vehicleUtilization[0] ? 
        ((vehicleUtilization[0].inUse / vehicleUtilization[0].total) * 100) : 0
    };

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics'
    });
  }
});

// @desc    Get recent rides for dashboard
// @route   GET /api/admin/dashboard/recent-rides
// @access  Private/Admin
router.get('/dashboard/recent-rides', checkPermission('dashboard', 'view'), [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1-50')
], async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const rides = await Ride.find()
      .populate('user', 'name email')
      .populate('vehicle', 'vehicleId type model')
      .sort({ createdAt: -1 })
      .limit(limit);

    res.status(200).json({
      success: true,
      data: rides
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent rides'
    });
  }
});

// @desc    Get chart data for dashboard
// @route   GET /api/admin/dashboard/charts
// @access  Private/Admin
router.get('/dashboard/charts', checkPermission('dashboard', 'view'), [
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
], async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();

    // Daily rides data
    const dailyRides = await Ride.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
          },
          rides: { $sum: 1 },
          revenue: { $sum: '$cost.total' }
        }
      },
      { $sort: { '_id.date': 1 } },
      {
        $project: {
          date: '$_id.date',
          rides: 1,
          revenue: 1,
          _id: 0
        }
      }
    ]);

    // Vehicle types distribution
    const vehicleTypes = await Vehicle.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          name: '$_id',
          value: '$count',
          _id: 0
        }
      }
    ]);

    // Hourly usage pattern
    const hourlyUsage = await Ride.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { hour: { $hour: '$createdAt' } },
          rides: { $sum: 1 }
        }
      },
      { $sort: { '_id.hour': 1 } },
      {
        $project: {
          hour: '$_id.hour',
          rides: 1,
          _id: 0
        }
      }
    ]);

    // Fill missing hours with 0
    const fullHourlyData = Array.from({ length: 24 }, (_, hour) => {
      const existing = hourlyUsage.find(h => h.hour === hour);
      return existing || { hour, rides: 0 };
    });

    res.status(200).json({
      success: true,
      data: {
        dailyRides,
        vehicleTypes,
        hourlyUsage: fullHourlyData
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chart data'
    });
  }
});

// @desc    Get all users with pagination
// @route   GET /api/admin/users
// @access  Private/Admin
router.get('/users', checkPermission('users', 'view'), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  query('search').optional().isLength({ min: 1 }).withMessage('Search term too short'),
  query('role').optional().isIn(['user', 'admin']).withMessage('Invalid role'),
  query('status').optional().isIn(['active', 'banned', 'inactive']).withMessage('Invalid status')
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

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    
    if (req.query.search) {
      query.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } },
        { phone: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    if (req.query.role) {
      query.role = req.query.role;
    }

    if (req.query.status) {
      switch (req.query.status) {
        case 'active':
          query.isActive = true;
          query.isBanned = false;
          break;
        case 'banned':
          query.isBanned = true;
          break;
        case 'inactive':
          query.isActive = false;
          break;
      }
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: users
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

// @desc    Update user status (ban/unban/activate/deactivate)
// @route   PUT /api/admin/users/:userId/status
// @access  Private/Admin
router.put('/users/:userId/status', checkPermission('users', 'edit'), [
  body('action').isIn(['ban', 'unban', 'activate', 'deactivate']).withMessage('Invalid action'),
  body('reason').optional().isLength({ min: 1, max: 500 }).withMessage('Reason must be 1-500 characters')
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

    const { userId } = req.params;
    const { action, reason } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent admin from modifying super admin
    if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot modify super admin user'
      });
    }

    switch (action) {
      case 'ban':
        user.isBanned = true;
        user.banReason = reason || 'Banned by admin';
        break;
      case 'unban':
        user.isBanned = false;
        user.banReason = undefined;
        break;
      case 'activate':
        user.isActive = true;
        break;
      case 'deactivate':
        user.isActive = false;
        break;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: `User ${action}d successfully`,
      data: {
        id: user._id,
        isActive: user.isActive,
        isBanned: user.isBanned,
        banReason: user.banReason
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
});

// @desc    Get zones
// @route   GET /api/admin/zones
// @access  Private/Admin
router.get('/zones', checkPermission('zones', 'view'), async (req, res) => {
  try {
    const zones = await Zone.find().sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      data: zones
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch zones'
    });
  }
});

// @desc    Create zone
// @route   POST /api/admin/zones
// @access  Private/Admin
router.post('/zones', checkPermission('zones', 'create'), [
  body('name').trim().notEmpty().withMessage('Zone name is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('maxVehicles').isInt({ min: 1 }).withMessage('Max vehicles must be at least 1')
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

    const zone = await Zone.create({
      ...req.body,
      // Set default pricing
      pricing: {
        scooter: {
          unlockFee: 1.0,
          perMinuteRate: 0.15
        },
        bike: {
          unlockFee: 1.0,
          perMinuteRate: 0.10
        },
        currency: 'USD',
        dayRental: {
          scooter: {
            dailyRate: 25.0,
            minimumDays: 2,
            deliveryFee: 5.0
          },
          bike: {
            dailyRate: 20.0,
            minimumDays: 2,
            deliveryFee: 5.0
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Zone created successfully',
      data: zone
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to create zone'
    });
  }
});

// @desc    Update zone pricing
// @route   PUT /api/admin/zones/:zoneId/pricing
// @access  Private/Admin
router.put('/zones/:zoneId/pricing', checkPermission('zones', 'edit'), async (req, res) => {
  try {
    const { zoneId } = req.params;
    const zone = await Zone.findById(zoneId);

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Zone not found'
      });
    }

    zone.pricing = { ...zone.pricing, ...req.body };
    await zone.save();

    res.status(200).json({
      success: true,
      message: 'Zone pricing updated successfully',
      data: zone
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update zone pricing'
    });
  }
});

// @desc    Get system alerts
// @route   GET /api/admin/alerts
// @access  Private/Admin
router.get('/alerts', checkPermission('alerts', 'view'), async (req, res) => {
  try {
    const { severity, isActive = true } = req.query;
    
    // جمع التنبيهات من المركبات
    const vehicleAlerts = await Vehicle.aggregate([
      { $unwind: '$alerts' },
      { 
        $match: {
          'alerts.isActive': isActive === 'true',
          ...(severity && { 'alerts.severity': severity })
        }
      },
      {
        $project: {
          _id: '$alerts._id',
          vehicleId: '$vehicleId',
          type: '$alerts.type',
          message: '$alerts.message',
          severity: '$alerts.severity',
          isActive: '$alerts.isActive',
          createdAt: '$alerts.createdAt'
        }
      },
      { $sort: { createdAt: -1 } }
    ]);
    
    res.status(200).json({
      success: true,
      count: vehicleAlerts.length,
      data: vehicleAlerts
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alerts'
    });
  }
});

// @desc    Create new user
// @route   POST /api/admin/users
// @access  Private/Admin
router.post('/users', checkPermission('users', 'create'), [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional().isIn(['user', 'admin']).withMessage('Invalid role')
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

    const { name, email, phone, password, role = 'user' } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }

    const user = await User.create({
      name,
      email,
      phone,
      password,
      role,
      isVerified: true // Admin created users are auto-verified
    });

    // Remove password from response
    user.password = undefined;

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user'
    });
  }
});

// @desc    Update user
// @route   PUT /api/admin/users/:userId
// @access  Private/Admin
router.put('/users/:userId', checkPermission('users', 'edit'), [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('email').optional().isEmail().withMessage('Valid email is required'),
  body('phone').optional().trim().notEmpty().withMessage('Phone cannot be empty'),
  body('role').optional().isIn(['user', 'admin']).withMessage('Invalid role')
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

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      req.body,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

// @desc    Delete user
// @route   DELETE /api/admin/users/:userId
// @access  Private/Admin
router.delete('/users/:userId', checkPermission('users', 'delete'), async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Don't allow deleting super admin
    if (user.role === 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete super admin'
      });
    }

    await User.findByIdAndDelete(req.params.userId);

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

// @desc    Add credit to user
// @route   POST /api/admin/users/:userId/credit
// @access  Private/Admin
router.post('/users/:userId/credit', checkPermission('users', 'edit'), [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0')
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
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Add credit to user's balance (assuming we have a balance field)
    user.balance = (user.balance || 0) + amount;
    await user.save();

    res.status(200).json({
      success: true,
      message: `Added $${amount} credit to user`,
      data: {
        userId: user._id,
        newBalance: user.balance
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to add credit'
    });
  }
});

// @desc    Get payments with pagination and filters
// @route   GET /api/admin/payments
// @access  Private/Admin
router.get('/payments', checkPermission('payments', 'view'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build query based on filters
    const query = {};
    
    if (req.query.status) {
      query.status = req.query.status;
    }
    
    if (req.query.method) {
      query.method = req.query.method;
    }
    
    if (req.query.startDate && req.query.endDate) {
      query.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    // Get payments from Ride model (assuming payments are part of rides)
    const payments = await Ride.find(query)
      .populate('user', 'name email phone')
      .populate('vehicle', 'vehicleId type')
      .select('user vehicle cost paymentMethod paymentStatus createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Ride.countDocuments(query);

    res.status(200).json({
      success: true,
      count: payments.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: payments
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payments'
    });
  }
});

// @desc    Get payment statistics
// @route   GET /api/admin/payments/stats
// @access  Private/Admin
router.get('/payments/stats', checkPermission('payments', 'view'), async (req, res) => {
  try {
    const period = req.query.period || '7d';
    let startDate;

    switch (period) {
      case '24h':
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    const [totalRevenue, successfulPayments, failedPayments, paymentMethods] = await Promise.all([
      Ride.aggregate([
        { $match: { paymentStatus: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: '$cost.total' } } }
      ]),
      Ride.countDocuments({ paymentStatus: 'completed', createdAt: { $gte: startDate } }),
      Ride.countDocuments({ paymentStatus: 'failed', createdAt: { $gte: startDate } }),
      Ride.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $group: { _id: '$paymentMethod', count: { $sum: 1 } } }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: totalRevenue[0]?.total || 0,
        totalTransactions: successfulPayments + failedPayments,
        successfulPayments,
        failedPayments,
        paymentMethods: paymentMethods.reduce((acc, method) => {
          acc[method._id] = method.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment statistics'
    });
  }
});

// @desc    Get rides with pagination and filters
// @route   GET /api/admin/rides
// @access  Private/Admin
router.get('/rides', checkPermission('vehicles', 'view'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build query based on filters
    const query = {};
    
    if (req.query.status) {
      query.status = req.query.status;
    }
    
    if (req.query.vehicleType) {
      // Need to populate vehicle and filter by type
    }
    
    if (req.query.startDate && req.query.endDate) {
      query.createdAt = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    const rides = await Ride.find(query)
      .populate('user', 'name email phone')
      .populate('vehicle', 'vehicleId type batteryLevel')
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
      message: 'Failed to fetch rides'
    });
  }
});

// @desc    Get ride statistics
// @route   GET /api/admin/rides/stats
// @access  Private/Admin
router.get('/rides/stats', checkPermission('rides', 'view'), async (req, res) => {
  try {
    const period = req.query.period || '7d';
    let startDate;

    switch (period) {
      case '24h':
        startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    const [
      totalRides,
      completedRides,
      cancelledRides,
      totalRevenue,
      avgDuration,
      avgDistance,
      avgRating
    ] = await Promise.all([
      Ride.countDocuments({ createdAt: { $gte: startDate } }),
      Ride.countDocuments({ status: 'completed', createdAt: { $gte: startDate } }),
      Ride.countDocuments({ status: 'cancelled', createdAt: { $gte: startDate } }),
      Ride.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: '$cost.total' } } }
      ]),
      Ride.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: null, avg: { $avg: '$duration' } } }
      ]),
      Ride.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: null, avg: { $avg: '$distance' } } }
      ]),
      Ride.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: startDate }, rating: { $exists: true, $ne: null } } },
        { $group: { _id: null, avg: { $avg: '$rating' } } }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalRides,
        completedRides,
        cancelledRides,
        totalRevenue: totalRevenue[0]?.total || 0,
        averageDuration: avgDuration[0]?.avg || 0,
        averageDistance: avgDistance[0]?.avg || 0,
        avgRating: avgRating[0]?.avg || 0
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ride statistics'
    });
  }
});

// @desc    Get system health
// @route   GET /api/admin/health
// @access  Private/Admin
router.get('/health', checkPermission('system', 'view'), async (req, res) => {
  try {
    const [
      totalVehicles,
      activeVehicles,
      lowBatteryVehicles,
      maintenanceVehicles,
      activeRides,
      totalUsers
    ] = await Promise.all([
      Vehicle.countDocuments(),
      Vehicle.countDocuments({ status: 'available' }),
      Vehicle.countDocuments({ batteryLevel: { $lt: 20 } }),
      Vehicle.countDocuments({ status: 'maintenance' }),
      Ride.countDocuments({ status: 'active' }),
      User.countDocuments({ role: 'user' })
    ]);

    const systemHealth = {
      vehicles: {
        total: totalVehicles,
        active: activeVehicles,
        lowBattery: lowBatteryVehicles,
        maintenance: maintenanceVehicles,
        utilization: totalVehicles > 0 ? (activeRides / totalVehicles * 100).toFixed(1) : 0
      },
      rides: {
        active: activeRides
      },
      users: {
        total: totalUsers
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date()
      }
    };

    res.status(200).json({
      success: true,
      data: systemHealth
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system health'
    });
  }
});

// @desc    Get advanced analytics
// @route   GET /api/admin/analytics/advanced
// @access  Private/Admin
router.get('/analytics/advanced', checkPermission('analytics', 'view'), async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    
    const matchStage = {};
    if (startDate && endDate) {
      matchStage.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Revenue analytics
    const revenueData = await Ride.aggregate([
      { $match: { ...matchStage, status: 'completed' } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: groupBy === 'hour' ? '%Y-%m-%d-%H' : '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          revenue: { $sum: '$cost.total' },
          rides: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // User analytics
    const userGrowth = await User.aggregate([
      { $match: { ...matchStage, role: 'user' } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          newUsers: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Vehicle utilization
    const vehicleUtilization = await Vehicle.aggregate([
      {
        $lookup: {
          from: 'rides',
          localField: '_id',
          foreignField: 'vehicle',
          as: 'rides'
        }
      },
      {
        $project: {
          vehicleId: 1,
          type: 1,
          totalRides: { $size: '$rides' },
          totalRevenue: {
            $sum: {
              $map: {
                input: '$rides',
                as: 'ride',
                in: '$$ride.cost.total'
              }
            }
          }
        }
      },
      { $sort: { totalRides: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        revenue: revenueData,
        userGrowth,
        vehicleUtilization
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch advanced analytics'
    });
  }
});

// @desc    Get analytics overview for dashboard
// @route   GET /api/admin/analytics/overview
// @access  Private (Admin)
router.get('/analytics/overview', checkPermission('analytics', 'view'), async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    
    const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 7;
    const dateFilter = {
      createdAt: {
        $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      }
    };

    const [
      totalRevenue,
      totalRides,
      activeUsers,
      revenueGrowth
    ] = await Promise.all([
      Ride.aggregate([
        { $match: { ...dateFilter, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$totalCost' } } }
      ]),
      Ride.countDocuments(dateFilter),
      Ride.distinct('userId', dateFilter).then(users => users.length),
      // Previous period for growth calculation
      Ride.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(Date.now() - 2 * days * 24 * 60 * 60 * 1000),
              $lt: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
            },
            status: 'completed'
          }
        },
        { $group: { _id: null, total: { $sum: '$totalCost' } } }
      ])
    ]);

    const currentRevenue = totalRevenue[0]?.total || 0;
    const previousRevenue = revenueGrowth[0]?.total || 0;
    const growth = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: currentRevenue,
        totalRides,
        activeUsers,
        revenueGrowth: Math.round(growth * 100) / 100,
        customerSatisfaction: 4.2
      }
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics overview'
    });
  }
});

// @desc    Get analytics charts data
// @route   GET /api/admin/analytics/charts
// @access  Private (Admin)
router.get('/analytics/charts', checkPermission('analytics', 'view'), async (req, res) => {
  try {
    const { startDate, endDate, period = 'daily' } = req.query;
    
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    } else {
      dateFilter = {
        createdAt: {
          $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      };
    }

    const [revenue, rides, users, vehicleTypes, paymentMethods, hourlyUsage] = await Promise.all([
      // Revenue chart
      Ride.aggregate([
        { $match: { ...dateFilter, status: 'completed' } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            revenue: { $sum: '$totalCost' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),
      
      // Rides chart
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            rides: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),
      
      // Users chart
      User.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            newUsers: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),
      
      // Vehicle types
      Vehicle.aggregate([
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Payment methods
      Ride.aggregate([
        { $match: { ...dateFilter, status: 'completed' } },
        {
          $group: {
            _id: '$payment.method',
            count: { $sum: 1 },
            revenue: { $sum: '$totalCost' }
          }
        }
      ]),
      
      // Hourly usage
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            rides: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        revenue: revenue.map(item => ({
          date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
          revenue: item.revenue
        })),
        rides: rides.map(item => ({
          date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
          rides: item.rides
        })),
        users: users.map(item => ({
          date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
          newUsers: item.newUsers
        })),
        vehicleTypes: vehicleTypes.map(item => ({
          type: item._id,
          count: item.count
        })),
        paymentMethods: paymentMethods.map(item => ({
          method: item._id || 'unknown',
          count: item.count,
          revenue: item.revenue
        })),
        hourlyUsage: hourlyUsage.map(item => ({
          hour: item._id,
          rides: item.rides
        }))
      }
    });
  } catch (error) {
    console.error('Analytics charts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics charts'
    });
  }
});

// @desc    Get analytics tables data
// @route   GET /api/admin/analytics/tables
// @access  Private (Admin)
router.get('/analytics/tables', checkPermission('analytics', 'view'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    } else {
      dateFilter = {
        createdAt: {
          $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        }
      };
    }

    const [topUsers, topVehicles, topZones, recentIssues] = await Promise.all([
      // Top users
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$userId',
            totalRides: { $sum: 1 },
            totalSpent: { $sum: '$totalCost' }
          }
        },
        { $sort: { totalRides: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' }
      ]),
      
      // Top vehicles
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$vehicleId',
            totalRides: { $sum: 1 },
            totalRevenue: { $sum: '$totalCost' }
          }
        },
        { $sort: { totalRides: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'vehicles',
            localField: '_id',
            foreignField: '_id',
            as: 'vehicle'
          }
        },
        { $unwind: '$vehicle' }
      ]),
      
      // Top zones
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$startZone',
            totalRides: { $sum: 1 },
            totalRevenue: { $sum: '$totalCost' }
          }
        },
        { $sort: { totalRides: -1 } },
        { $limit: 10 }
      ]),
      
      // Recent issues (vehicles needing attention)
      Vehicle.find({
        $or: [
          { batteryLevel: { $lt: 20 } },
          { status: 'maintenance' },
          { status: 'damaged' }
        ]
      }).select('identifier type status batteryLevel location').limit(10).lean()
    ]);

    res.status(200).json({
      success: true,
      data: {
        topUsers: topUsers.map(item => ({
          _id: item._id,
          name: item.user.name,
          email: item.user.email,
          totalRides: item.totalRides,
          totalSpent: item.totalSpent
        })),
        topVehicles: topVehicles.map(item => ({
          _id: item._id,
          identifier: item.vehicle.identifier,
          type: item.vehicle.type,
          totalRides: item.totalRides,
          totalRevenue: item.totalRevenue
        })),
        topZones: topZones.map(item => ({
          _id: item._id,
          name: `Zone ${item._id}`,
          totalRides: item.totalRides,
          totalRevenue: item.totalRevenue
        })),
        recentIssues: recentIssues.map(item => ({
          _id: item._id,
          identifier: item.identifier,
          type: item.type,
          status: item.status,
          batteryLevel: item.batteryLevel,
          issue: item.batteryLevel < 20 ? 'Low Battery' : 
                item.status === 'maintenance' ? 'Maintenance Required' : 'Damaged'
        }))
      }
    });
  } catch (error) {
    console.error('Analytics tables error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics tables'
    });
  }
});

// @desc    Get settings
// @route   GET /api/admin/settings
// @access  Private/Admin
router.get('/settings', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const Settings = require('../models/Settings');
    const settings = await Settings.getSettings();
    
    res.status(200).json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings'
    });
  }
});

// @desc    Update settings
// @route   PUT /api/admin/settings
// @access  Private/Admin
router.put('/settings', checkPermission('settings', 'edit'), [
  body('general.siteName').optional().trim().notEmpty().withMessage('Site name cannot be empty'),
  body('general.siteDescription').optional().trim().notEmpty().withMessage('Site description cannot be empty'),
  body('general.contactEmail').optional().isEmail().withMessage('Valid contact email is required'),
  body('general.supportPhone').optional().trim().notEmpty().withMessage('Support phone cannot be empty'),
  body('pricing.baseFare').optional().isFloat({ min: 0 }).withMessage('Base fare must be a positive number'),
  body('pricing.perMinuteRate').optional().isFloat({ min: 0 }).withMessage('Per minute rate must be a positive number'),
  body('pricing.perKmRate').optional().isFloat({ min: 0 }).withMessage('Per km rate must be a positive number'),
  body('notifications.emailEnabled').optional().isBoolean().withMessage('Email enabled must be boolean'),
  body('notifications.smsEnabled').optional().isBoolean().withMessage('SMS enabled must be boolean'),
  body('notifications.pushEnabled').optional().isBoolean().withMessage('Push enabled must be boolean'),
  body('security.maxLoginAttempts').optional().isInt({ min: 1 }).withMessage('Max login attempts must be at least 1'),
  body('security.lockoutDuration').optional().isInt({ min: 1 }).withMessage('Lockout duration must be at least 1'),
  body('security.sessionTimeout').optional().isInt({ min: 1 }).withMessage('Session timeout must be at least 1')
], async (req, res) => {
  try {
    console.log('Received settings update request:', req.body);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const Settings = require('../models/Settings');
    const updatedSettings = await Settings.updateSettings(req.body);
    
    console.log('Settings updated successfully:', updatedSettings);
    
    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      data: updatedSettings
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings',
      error: error.message
    });
  }
});

// @desc    Get general settings
// @route   GET /api/admin/settings/general
// @access  Private/Admin
router.get('/settings/general', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const Settings = require('../models/Settings');
    const settings = await Settings.getSettings();
    
    res.status(200).json({
      success: true,
      data: settings.general
    });
  } catch (error) {
    console.error('Get general settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch general settings'
    });
  }
});

// @desc    Update general settings
// @route   PUT /api/admin/settings/general
// @access  Private/Admin
router.put('/settings/general', checkPermission('settings', 'edit'), [
  body('siteName').optional().trim().notEmpty().withMessage('Site name cannot be empty'),
  body('siteDescription').optional().trim().notEmpty().withMessage('Site description cannot be empty'),
  body('contactEmail').optional().isEmail().withMessage('Valid contact email is required'),
  body('supportPhone').optional().trim().notEmpty().withMessage('Support phone cannot be empty')
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

    const Settings = require('../models/Settings');
    const updatedSettings = await Settings.updateSettings({ general: req.body });
    
    res.status(200).json({
      success: true,
      message: 'General settings updated successfully',
      data: updatedSettings.general
    });
  } catch (error) {
    console.error('Update general settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update general settings'
    });
  }
});

// @desc    Get notification settings
// @route   GET /api/admin/settings/notifications
// @access  Private/Admin
router.get('/settings/notifications', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const Settings = require('../models/Settings');
    const settings = await Settings.getSettings();
    
    res.status(200).json({
      success: true,
      data: settings.notifications
    });
  } catch (error) {
    console.error('Get notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification settings'
    });
  }
});

// @desc    Update notification settings
// @route   PUT /api/admin/settings/notifications
// @access  Private/Admin
router.put('/settings/notifications', checkPermission('settings', 'edit'), [
  body('emailEnabled').optional().isBoolean().withMessage('Email enabled must be boolean'),
  body('smsEnabled').optional().isBoolean().withMessage('SMS enabled must be boolean'),
  body('pushEnabled').optional().isBoolean().withMessage('Push enabled must be boolean')
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

    const Settings = require('../models/Settings');
    const updatedSettings = await Settings.updateSettings({ notifications: req.body });
    
    res.status(200).json({
      success: true,
      message: 'Notification settings updated successfully',
      data: updatedSettings.notifications
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification settings'
    });
  }
});

// @desc    Get security settings
// @route   GET /api/admin/settings/security
// @access  Private/Admin
router.get('/settings/security', checkPermission('settings', 'view'), async (req, res) => {
  try {
    const Settings = require('../models/Settings');
    const settings = await Settings.getSettings();
    
    res.status(200).json({
      success: true,
      data: settings.security
    });
  } catch (error) {
    console.error('Get security settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch security settings'
    });
  }
});

// @desc    Update security settings
// @route   PUT /api/admin/settings/security
// @access  Private/Admin
router.put('/settings/security', checkPermission('settings', 'edit'), [
  body('maxLoginAttempts').optional().isInt({ min: 1 }).withMessage('Max login attempts must be at least 1'),
  body('lockoutDuration').optional().isInt({ min: 1 }).withMessage('Lockout duration must be at least 1'),
  body('sessionTimeout').optional().isInt({ min: 1 }).withMessage('Session timeout must be at least 1')
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

    const Settings = require('../models/Settings');
    const updatedSettings = await Settings.updateSettings({ security: req.body });
    
    res.status(200).json({
      success: true,
      message: 'Security settings updated successfully',
      data: updatedSettings.security
    });
  } catch (error) {
    console.error('Update security settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update security settings'
    });
  }
});

// Admin management routes
router.get('/admins', checkPermission('admins', 'view'), async (req, res) => {
  try {
    const admins = await Admin.find({}, '-password')
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: admins
    });
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admins'
    });
  }
});

router.post('/admins', checkPermission('admins', 'create'), [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['admin', 'call_center', 'supervisor']).withMessage('Invalid role'),
  body('profile.firstName').trim().notEmpty().withMessage('First name is required'),
  body('profile.lastName').trim().notEmpty().withMessage('Last name is required')
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

    const { username, email, password, role, profile, permissions } = req.body;

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({
      $or: [{ email }, { username }]
    });

    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Admin with this email or username already exists'
      });
    }

    const admin = new Admin({
      username,
      email,
      password,
      role,
      profile,
      permissions: permissions || {},
      createdBy: req.user.id
    });

    await admin.save();

    // Remove password from response
    const adminResponse = admin.toObject();
    delete adminResponse.password;

    res.status(201).json({
      success: true,
      data: adminResponse,
      message: 'Admin created successfully'
    });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create admin'
    });
  }
});

router.put('/admins/:adminId', checkPermission('admins', 'edit'), [
  body('username').optional().trim().notEmpty().withMessage('Username cannot be empty'),
  body('email').optional().isEmail().withMessage('Valid email is required'),
  body('role').optional().isIn(['admin', 'call_center', 'supervisor']).withMessage('Invalid role'),
  body('profile.firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
  body('profile.lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty')
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

    const { adminId } = req.params;
    const updateData = req.body;

    // Remove password from update data if present
    delete updateData.password;

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.json({
      success: true,
      data: admin,
      message: 'Admin updated successfully'
    });
  } catch (error) {
    console.error('Update admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update admin'
    });
  }
});

router.put('/admins/:adminId/permissions', checkPermission('admins', 'edit'), [
  body('permissions').isObject().withMessage('Permissions must be an object')
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

    const { adminId } = req.params;
    const { permissions } = req.body;

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      { permissions },
      { new: true, runValidators: true }
    ).select('-password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.json({
      success: true,
      data: admin,
      message: 'Admin permissions updated successfully'
    });
  } catch (error) {
    console.error('Update admin permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update admin permissions'
    });
  }
});

router.put('/admins/:adminId/status', checkPermission('admins', 'edit'), [
  body('isActive').isBoolean().withMessage('Status must be boolean')
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

    const { adminId } = req.params;
    const { isActive } = req.body;

    const admin = await Admin.findByIdAndUpdate(
      adminId,
      { isActive },
      { new: true }
    ).select('-password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.json({
      success: true,
      data: admin,
      message: `Admin ${isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Update admin status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update admin status'
    });
  }
});

router.delete('/admins/:adminId', checkPermission('admins', 'delete'), async (req, res) => {
  try {
    const { adminId } = req.params;

    // Prevent self-deletion
    if (adminId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const admin = await Admin.findByIdAndDelete(adminId);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.json({
      success: true,
      message: 'Admin deleted successfully'
    });
  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete admin'
    });
  }
});

// @desc    Get user permissions
// @route   GET /api/admin/permissions
// @access  Private/Admin
router.get('/permissions', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        role: req.user.role,
        permissions: req.user.permissions
      }
    });
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get permissions'
    });
  }
});

module.exports = router;
