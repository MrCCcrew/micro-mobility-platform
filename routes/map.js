const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { query, validationResult } = require('express-validator');
const Vehicle = require('../models/Vehicle');
const Zone = require('../models/Zone');
const Ride = require('../models/Ride');

// Apply authentication middleware
router.use(protect);

// @desc    Get map data (vehicles, zones, alerts)
// @route   GET /api/map/data
// @access  Private
router.get('/data', async (req, res) => {
  try {
    const { bounds } = req.query;
    let vehicleFilter = { status: { $in: ['available', 'in_use'] } };
    
    // If bounds are provided, filter vehicles within bounds
    if (bounds) {
      const { north, south, east, west } = JSON.parse(bounds);
      vehicleFilter['location.coordinates'] = {
        $geoWithin: {
          $box: [[west, south], [east, north]]
        }
      };
    }

    const [vehicles, zones, alerts] = await Promise.all([
      Vehicle.find(vehicleFilter)
        .select('identifier type status batteryLevel location lastSeen')
        .lean(),
      
      Zone.find({ isActive: true })
        .select('name type boundaries pricing restrictions')
        .lean(),
      
      // Get vehicle alerts (low battery, maintenance needed, etc.)
      Vehicle.find({
        $or: [
          { batteryLevel: { $lt: 20 } },
          { status: 'maintenance' },
          { lastSeen: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } } // Not seen for 2 hours
        ]
      }).select('identifier type status batteryLevel location lastSeen').lean()
    ]);

    res.status(200).json({
      success: true,
      data: {
        vehicles: vehicles.map(vehicle => ({
          id: vehicle._id,
          identifier: vehicle.identifier,
          type: vehicle.type,
          status: vehicle.status,
          batteryLevel: vehicle.batteryLevel,
          location: vehicle.location,
          lastSeen: vehicle.lastSeen
        })),
        zones: zones.map(zone => ({
          id: zone._id,
          name: zone.name,
          type: zone.type,
          boundaries: zone.boundaries,
          pricing: zone.pricing,
          restrictions: zone.restrictions
        })),
        alerts: alerts.map(alert => ({
          id: alert._id,
          identifier: alert.identifier,
          type: alert.type,
          status: alert.status,
          batteryLevel: alert.batteryLevel,
          location: alert.location,
          lastSeen: alert.lastSeen,
          alertType: alert.batteryLevel < 20 ? 'low_battery' : 
                    alert.status === 'maintenance' ? 'maintenance' : 'offline'
        }))
      }
    });
  } catch (error) {
    console.error('Map data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch map data'
    });
  }
});

// @desc    Get vehicles for map
// @route   GET /api/map/vehicles
// @access  Private
router.get('/vehicles', [
  query('lat').optional().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  query('lng').optional().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  query('radius').optional().isFloat({ min: 0 }).withMessage('Valid radius is required'),
  query('type').optional().isIn(['scooter', 'bike', 'ebike']).withMessage('Invalid vehicle type')
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

    const { lat, lng, radius = 5000, type, status = 'available' } = req.query;
    
    let filter = { status: { $in: status.split(',') } };
    
    if (type) {
      filter.type = type;
    }

    // If location is provided, find nearby vehicles
    if (lat && lng) {
      filter.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseInt(radius)
        }
      };
    }

    const vehicles = await Vehicle.find(filter)
      .select('identifier type status batteryLevel location lastSeen')
      .limit(100)
      .lean();

    res.status(200).json({
      success: true,
      data: vehicles.map(vehicle => ({
        id: vehicle._id,
        identifier: vehicle.identifier,
        type: vehicle.type,
        status: vehicle.status,
        batteryLevel: vehicle.batteryLevel,
        location: vehicle.location,
        lastSeen: vehicle.lastSeen
      }))
    });
  } catch (error) {
    console.error('Map vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicles'
    });
  }
});

// @desc    Get zones for map
// @route   GET /api/map/zones
// @access  Private
router.get('/zones', async (req, res) => {
  try {
    const { type } = req.query;
    
    let filter = { isActive: true };
    if (type) {
      filter.type = type;
    }

    const zones = await Zone.find(filter)
      .select('name type boundaries pricing restrictions color')
      .lean();

    res.status(200).json({
      success: true,
      data: zones.map(zone => ({
        id: zone._id,
        name: zone.name,
        type: zone.type,
        boundaries: zone.boundaries,
        pricing: zone.pricing,
        restrictions: zone.restrictions,
        color: zone.color || '#007bff'
      }))
    });
  } catch (error) {
    console.error('Map zones error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch zones'
    });
  }
});

// @desc    Get alerts for map
// @route   GET /api/map/alerts
// @access  Private
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await Vehicle.find({
      $or: [
        { batteryLevel: { $lt: 20 } },
        { status: 'maintenance' },
        { status: 'damaged' },
        { lastSeen: { $lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } }
      ]
    }).select('identifier type status batteryLevel location lastSeen').lean();

    res.status(200).json({
      success: true,
      data: alerts.map(alert => ({
        id: alert._id,
        identifier: alert.identifier,
        type: alert.type,
        status: alert.status,
        batteryLevel: alert.batteryLevel,
        location: alert.location,
        lastSeen: alert.lastSeen,
        alertType: alert.batteryLevel < 20 ? 'low_battery' : 
                  alert.status === 'maintenance' ? 'maintenance' :
                  alert.status === 'damaged' ? 'damaged' : 'offline',
        severity: alert.batteryLevel < 10 || alert.status === 'damaged' ? 'high' :
                 alert.batteryLevel < 20 || alert.status === 'maintenance' ? 'medium' : 'low'
      }))
    });
  } catch (error) {
    console.error('Map alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch alerts'
    });
  }
});

// @desc    Update vehicle location
// @route   PUT /api/map/vehicles/:vehicleId/location
// @access  Private (Admin)
router.put('/vehicles/:vehicleId/location', authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { location } = req.body;

    if (!location || !location.coordinates || location.coordinates.length !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Valid location coordinates are required'
      });
    }

    const vehicle = await Vehicle.findByIdAndUpdate(
      vehicleId,
      {
        location: {
          type: 'Point',
          coordinates: location.coordinates
        },
        lastSeen: new Date()
      },
      { new: true }
    ).select('identifier type status location lastSeen');

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Emit real-time update via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('vehicleLocationUpdate', {
        vehicleId: vehicle._id,
        identifier: vehicle.identifier,
        location: vehicle.location,
        lastSeen: vehicle.lastSeen
      });
    }

    res.status(200).json({
      success: true,
      data: vehicle
    });
  } catch (error) {
    console.error('Update vehicle location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vehicle location'
    });
  }
});

// @desc    Get nearby vehicles
// @route   GET /api/map/nearby
// @access  Private
router.get('/nearby', [
  query('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  query('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  query('radius').optional().isFloat({ min: 0 }).withMessage('Valid radius is required')
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

    const { lat, lng, radius = 1000, limit = 20 } = req.query;

    const vehicles = await Vehicle.find({
      status: 'available',
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseInt(radius)
        }
      }
    })
    .select('identifier type batteryLevel location')
    .limit(parseInt(limit))
    .lean();

    res.status(200).json({
      success: true,
      data: vehicles.map(vehicle => ({
        id: vehicle._id,
        identifier: vehicle.identifier,
        type: vehicle.type,
        batteryLevel: vehicle.batteryLevel,
        location: vehicle.location,
        distance: 0 // This would be calculated based on user location
      }))
    });
  } catch (error) {
    console.error('Nearby vehicles error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch nearby vehicles'
    });
  }
});

// @desc    Real-time vehicle tracking
// @route   GET /api/map/track/:vehicleId
// @access  Private
router.get('/track/:vehicleId', async (req, res) => {
  try {
    const { vehicleId } = req.params;

    const vehicle = await Vehicle.findById(vehicleId)
      .select('identifier type status batteryLevel location lastSeen')
      .lean();

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Check if vehicle is currently in use
    const activeRide = await Ride.findOne({
      vehicleId: vehicleId,
      status: 'active'
    }).select('userId startTime').populate('userId', 'name').lean();

    res.status(200).json({
      success: true,
      data: {
        vehicle: {
          id: vehicle._id,
          identifier: vehicle.identifier,
          type: vehicle.type,
          status: vehicle.status,
          batteryLevel: vehicle.batteryLevel,
          location: vehicle.location,
          lastSeen: vehicle.lastSeen
        },
        activeRide: activeRide ? {
          userId: activeRide.userId._id,
          userName: activeRide.userId.name,
          startTime: activeRide.startTime
        } : null
      }
    });
  } catch (error) {
    console.error('Vehicle tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track vehicle'
    });
  }
});

module.exports = router;