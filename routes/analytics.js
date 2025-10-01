const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { query, validationResult } = require('express-validator');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const Ride = require('../models/Ride');
const Payment = require('../models/Payment');
const Zone = require('../models/Zone');

// Apply authentication and authorization middleware
router.use(protect);
router.use(authorize('admin', 'super_admin'));

// @desc    Get analytics overview
// @route   GET /api/analytics/overview
// @access  Private (Admin)
router.get('/overview', [
  query('period').optional().isIn(['1d', '7d', '30d', '90d', '1y']).withMessage('Invalid period'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { period = '7d', startDate, endDate } = req.query;
    
    // Calculate date range
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    } else {
      const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
      dateFilter = {
        createdAt: {
          $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        }
      };
    }

    // Get overview statistics
    const [
      totalRevenue,
      totalRides,
      activeUsers,
      activeVehicles,
      avgRideStats,
      previousPeriodRevenue,
      previousPeriodRides,
      previousPeriodUsers
    ] = await Promise.all([
      // Total revenue
      Ride.aggregate([
        { $match: { ...dateFilter, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$totalCost' } } }
      ]),
      
      // Total rides
      Ride.countDocuments(dateFilter),
      
      // Active users (users who made rides in period)
      Ride.distinct('userId', dateFilter).then(users => users.length),
      
      // Active vehicles
      Vehicle.countDocuments({ status: 'available' }),
      
      // Average ride statistics
      Ride.aggregate([
        { $match: { ...dateFilter, status: 'completed' } },
        {
          $group: {
            _id: null,
            avgDistance: { $avg: '$distance' },
            avgDuration: { $avg: '$duration' },
            avgCost: { $avg: '$totalCost' }
          }
        }
      ]),
      
      // Previous period revenue for growth calculation
      Ride.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(Date.now() - 2 * (period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365) * 24 * 60 * 60 * 1000),
              $lt: dateFilter.createdAt.$gte
            },
            status: 'completed'
          }
        },
        { $group: { _id: null, total: { $sum: '$totalCost' } } }
      ]),
      
      // Previous period rides
      Ride.countDocuments({
        createdAt: {
          $gte: new Date(Date.now() - 2 * (period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365) * 24 * 60 * 60 * 1000),
          $lt: dateFilter.createdAt.$gte
        }
      }),
      
      // Previous period users
      Ride.distinct('userId', {
        createdAt: {
          $gte: new Date(Date.now() - 2 * (period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365) * 24 * 60 * 60 * 1000),
          $lt: dateFilter.createdAt.$gte
        }
      }).then(users => users.length)
    ]);

    const currentRevenue = totalRevenue[0]?.total || 0;
    const prevRevenue = previousPeriodRevenue[0]?.total || 0;
    const revenueGrowth = prevRevenue > 0 ? ((currentRevenue - prevRevenue) / prevRevenue) * 100 : 0;
    
    const ridesGrowth = previousPeriodRides > 0 ? ((totalRides - previousPeriodRides) / previousPeriodRides) * 100 : 0;
    const usersGrowth = previousPeriodUsers > 0 ? ((activeUsers - previousPeriodUsers) / previousPeriodUsers) * 100 : 0;

    const avgStats = avgRideStats[0] || { avgDistance: 0, avgDuration: 0, avgCost: 0 };

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: currentRevenue,
        totalRides,
        activeUsers,
        activeVehicles,
        avgRideDistance: avgStats.avgDistance || 0,
        avgRideDuration: avgStats.avgDuration || 0,
        avgRideCost: avgStats.avgCost || 0,
        revenueGrowth: Math.round(revenueGrowth * 100) / 100,
        ridesGrowth: Math.round(ridesGrowth * 100) / 100,
        usersGrowth: Math.round(usersGrowth * 100) / 100,
        customerSatisfaction: 4.2 // This would come from ride ratings
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

// @desc    Get revenue analytics
// @route   GET /api/analytics/revenue
// @access  Private (Admin)
router.get('/revenue', [
  query('period').optional().isIn(['daily', 'weekly', 'monthly']).withMessage('Invalid period'),
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const { period = 'daily', startDate, endDate } = req.query;
    
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

    let groupBy;
    switch (period) {
      case 'daily':
        groupBy = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
        break;
      case 'weekly':
        groupBy = {
          year: { $year: '$createdAt' },
          week: { $week: '$createdAt' }
        };
        break;
      case 'monthly':
        groupBy = {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
        break;
    }

    const revenueData = await Ride.aggregate([
      { $match: { ...dateFilter, status: 'completed' } },
      {
        $group: {
          _id: groupBy,
          revenue: { $sum: '$totalCost' },
          rides: { $sum: 1 },
          avgRevenue: { $avg: '$totalCost' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: revenueData.map(item => ({
        date: period === 'daily' 
          ? `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`
          : period === 'weekly'
          ? `${item._id.year}-W${item._id.week}`
          : `${item._id.year}-${String(item._id.month).padStart(2, '0')}`,
        revenue: item.revenue,
        rides: item.rides,
        avgRevenue: item.avgRevenue
      }))
    });
  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch revenue analytics'
    });
  }
});

// @desc    Get user analytics
// @route   GET /api/analytics/users
// @access  Private (Admin)
router.get('/users', async (req, res) => {
  try {
    const { period = 'daily', startDate, endDate } = req.query;
    
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

    const [newUsers, activeUsers, topUsers] = await Promise.all([
      // New user registrations
      User.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),
      
      // Active users (users with rides)
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              userId: '$userId',
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            }
          }
        },
        {
          $group: {
            _id: {
              year: '$_id.year',
              month: '$_id.month',
              day: '$_id.day'
            },
            activeUsers: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),
      
      // Top users by rides
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
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        newUsers: newUsers.map(item => ({
          date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
          count: item.count
        })),
        activeUsers: activeUsers.map(item => ({
          date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
          count: item.activeUsers
        })),
        topUsers: topUsers.map(item => ({
          _id: item._id,
          name: item.user.name,
          email: item.user.email,
          totalRides: item.totalRides,
          totalSpent: item.totalSpent
        }))
      }
    });
  } catch (error) {
    console.error('User analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user analytics'
    });
  }
});

// @desc    Get vehicle analytics
// @route   GET /api/analytics/vehicles
// @access  Private (Admin)
router.get('/vehicles', async (req, res) => {
  try {
    const { period = 'daily', startDate, endDate } = req.query;
    
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

    const [vehicleTypes, topVehicles, utilizationStats] = await Promise.all([
      // Vehicle type distribution
      Vehicle.aggregate([
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            available: {
              $sum: {
                $cond: [{ $eq: ['$status', 'available'] }, 1, 0]
              }
            }
          }
        }
      ]),
      
      // Top performing vehicles
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$vehicleId',
            totalRides: { $sum: 1 },
            totalRevenue: { $sum: '$totalCost' },
            totalDistance: { $sum: '$distance' }
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
      
      // Vehicle utilization stats
      Vehicle.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        vehicleTypes: vehicleTypes.map(item => ({
          type: item._id,
          total: item.count,
          available: item.available,
          utilization: item.count > 0 ? ((item.count - item.available) / item.count * 100).toFixed(1) : 0
        })),
        topVehicles: topVehicles.map(item => ({
          _id: item._id,
          identifier: item.vehicle.identifier,
          type: item.vehicle.type,
          totalRides: item.totalRides,
          totalRevenue: item.totalRevenue,
          totalDistance: item.totalDistance
        })),
        utilizationStats: utilizationStats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Vehicle analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicle analytics'
    });
  }
});

// @desc    Get ride analytics
// @route   GET /api/analytics/rides
// @access  Private (Admin)
router.get('/rides', async (req, res) => {
  try {
    const { period = 'daily', startDate, endDate } = req.query;
    
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

    const [ridesByDay, ridesByHour, ridesByStatus] = await Promise.all([
      // Rides by day
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            rides: { $sum: 1 },
            revenue: { $sum: '$totalCost' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]),
      
      // Rides by hour of day
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: { $hour: '$createdAt' },
            rides: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]),
      
      // Rides by status
      Ride.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        ridesByDay: ridesByDay.map(item => ({
          date: `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
          rides: item.rides,
          revenue: item.revenue
        })),
        ridesByHour: ridesByHour.map(item => ({
          hour: item._id,
          rides: item.rides
        })),
        ridesByStatus: ridesByStatus.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    console.error('Ride analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ride analytics'
    });
  }
});

// @desc    Get zone performance analytics
// @route   GET /api/analytics/zones
// @access  Private (Admin)
router.get('/zones', async (req, res) => {
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

    const zonePerformance = await Ride.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$startZone',
          totalRides: { $sum: 1 },
          totalRevenue: { $sum: '$totalCost' },
          avgDistance: { $avg: '$distance' },
          avgDuration: { $avg: '$duration' }
        }
      },
      { $sort: { totalRides: -1 } },
      {
        $lookup: {
          from: 'zones',
          localField: '_id',
          foreignField: '_id',
          as: 'zone'
        }
      },
      { $unwind: { path: '$zone', preserveNullAndEmptyArrays: true } }
    ]);

    res.status(200).json({
      success: true,
      data: zonePerformance.map(item => ({
        zoneId: item._id,
        zoneName: item.zone?.name || 'Unknown Zone',
        totalRides: item.totalRides,
        totalRevenue: item.totalRevenue,
        avgDistance: item.avgDistance,
        avgDuration: item.avgDuration
      }))
    });
  } catch (error) {
    console.error('Zone analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch zone analytics'
    });
  }
});

// @desc    Export analytics data
// @route   GET /api/analytics/export/:type
// @access  Private (Admin)
router.get('/export/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { startDate, endDate, format = 'csv' } = req.query;
    
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

    let data = [];
    let filename = '';
    let headers = [];

    switch (type) {
      case 'rides':
        data = await Ride.find(dateFilter)
          .populate('userId', 'name email')
          .populate('vehicleId', 'identifier type')
          .select('rideId userId vehicleId startTime endTime distance duration totalCost status')
          .lean();
        
        filename = `rides_export_${new Date().toISOString().split('T')[0]}.csv`;
        headers = ['Ride ID', 'User Name', 'User Email', 'Vehicle ID', 'Vehicle Type', 'Start Time', 'End Time', 'Distance (km)', 'Duration (min)', 'Cost', 'Status'];
        
        data = data.map(ride => [
          ride.rideId,
          ride.userId?.name || 'N/A',
          ride.userId?.email || 'N/A',
          ride.vehicleId?.identifier || 'N/A',
          ride.vehicleId?.type || 'N/A',
          ride.startTime?.toISOString() || 'N/A',
          ride.endTime?.toISOString() || 'N/A',
          ride.distance || 0,
          ride.duration || 0,
          ride.totalCost || 0,
          ride.status
        ]);
        break;

      case 'revenue':
        data = await Ride.aggregate([
          { $match: { ...dateFilter, status: 'completed' } },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' }
              },
              totalRevenue: { $sum: '$totalCost' },
              totalRides: { $sum: 1 },
              avgRevenue: { $avg: '$totalCost' }
            }
          },
          { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
        ]);
        
        filename = `revenue_export_${new Date().toISOString().split('T')[0]}.csv`;
        headers = ['Date', 'Total Revenue', 'Total Rides', 'Average Revenue'];
        
        data = data.map(item => [
          `${item._id.year}-${String(item._id.month).padStart(2, '0')}-${String(item._id.day).padStart(2, '0')}`,
          item.totalRevenue,
          item.totalRides,
          item.avgRevenue
        ]);
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid export type'
        });
    }

    if (format === 'csv') {
      const csvContent = [headers.join(','), ...data.map(row => row.join(','))].join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvContent);
    } else {
      res.status(400).json({
        success: false,
        message: 'Unsupported export format'
      });
    }
  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export analytics data'
    });
  }
});

module.exports = router;