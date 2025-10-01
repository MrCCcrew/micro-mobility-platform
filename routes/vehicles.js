const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Vehicle = require('../models/Vehicle');
const Zone = require('../models/Zone');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Get available vehicles near location
// @route   GET /api/vehicles/nearby
// @access  Private
router.get('/nearby', protect, [
  query('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  query('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  query('radius').optional().isFloat({ min: 0.1, max: 50 }).withMessage('Radius must be between 0.1 and 50 km'),
  query('type').optional().isIn(['scooter', 'bike']).withMessage('Type must be scooter or bike')
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

    const { latitude, longitude, radius = 2, type } = req.query;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const searchRadius = parseFloat(radius);

    // Build query
    const query = {
      status: 'available',
      isActive: true,
      batteryLevel: { $gt: 10 },
      currentRide: null,
      location: {
        $geoWithin: {
          $centerSphere: [[lng, lat], searchRadius / 6371] // Convert km to radians
        }
      }
    };

    if (type) {
      query.type = type;
    }

    const vehicles = await Vehicle.find(query)
      .populate('zone', 'name pricing operatingHours')
      .select('vehicleId type model batteryLevel location address pricing hasLock lockType images')
      .sort({ batteryLevel: -1 })
      .limit(50);

    // Calculate distance for each vehicle
    const vehiclesWithDistance = vehicles.map(vehicle => {
      const distance = vehicle.distanceTo(lng, lat);
      return {
        ...vehicle.toObject(),
        distance: Math.round(distance * 100) / 100 // Round to 2 decimal places
      };
    });

    // Sort by distance
    vehiclesWithDistance.sort((a, b) => a.distance - b.distance);

    res.status(200).json({
      success: true,
      count: vehiclesWithDistance.length,
      data: vehiclesWithDistance
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching nearby vehicles'
    });
  }
});

// @desc    Get vehicle by ID or QR code
// @route   GET /api/vehicles/:identifier
// @access  Private
router.get('/:identifier', protect, async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Try to find by vehicle ID first, then by QR code
    let vehicle = await Vehicle.findOne({
      $or: [
        { vehicleId: identifier.toUpperCase() },
        { qrCode: identifier }
      ]
    }).populate('zone', 'name pricing operatingHours parkingRules');

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Check if vehicle is available
    const isAvailable = vehicle.isAvailable;

    res.status(200).json({
      success: true,
      data: {
        ...vehicle.toObject(),
        isAvailable
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching vehicle'
    });
  }
});

// @desc    Unlock vehicle (start ride)
// @route   POST /api/vehicles/:vehicleId/unlock
// @access  Private
router.post('/:vehicleId/unlock', protect, async (req, res) => {
  try {
    const { vehicleId } = req.params;
    
    const vehicle = await Vehicle.findOne({ vehicleId: vehicleId.toUpperCase() })
      .populate('zone', 'pricing operatingHours');

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Check if vehicle is available
    if (!vehicle.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle is not available',
        details: {
          status: vehicle.status,
          batteryLevel: vehicle.batteryLevel,
          currentRide: vehicle.currentRide
        }
      });
    }

    // Check if zone is operating
    if (!vehicle.zone.isOperating()) {
      return res.status(400).json({
        success: false,
        message: 'Service is not available at this time',
        operatingHours: vehicle.zone.operatingHours
      });
    }

    // Check if user has any active rides
    const Ride = require('../models/Ride');
    const activeRide = await Ride.findOne({
      user: req.user.id,
      status: 'active'
    });

    if (activeRide) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active ride. Please end your current ride first.',
        activeRide: activeRide._id
      });
    }

    // Create new ride
    const rideId = `RIDE-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    const ride = new Ride({
      rideId,
      user: req.user.id,
      vehicle: vehicle._id,
      startLocation: {
        coordinates: vehicle.location.coordinates,
        address: vehicle.address
      },
      pricing: {
        unlockFee: vehicle.zone.pricing[vehicle.type].unlockFee,
        perMinuteRate: vehicle.zone.pricing[vehicle.type].perMinuteRate,
        currency: vehicle.zone.pricing.currency
      },
      cost: {
        unlockFee: vehicle.zone.pricing[vehicle.type].unlockFee,
        total: vehicle.zone.pricing[vehicle.type].unlockFee,
        currency: vehicle.zone.pricing.currency
      },
      payment: {
        method: 'card', // Default, should be from user's preferred payment method
        status: 'pending'
      }
    });

    await ride.save();

    // Update vehicle status
    vehicle.status = 'in_use';
    vehicle.currentRide = ride._id;
    await vehicle.save();

    // Update user stats
    req.user.totalRides += 1;
    await req.user.save();

    // Emit real-time update
    const io = req.app.get('io');
    io.emit('vehicle-status-changed', {
      vehicleId: vehicle.vehicleId,
      status: 'in_use',
      location: vehicle.location
    });

    res.status(200).json({
      success: true,
      message: 'Vehicle unlocked successfully',
      data: {
        ride: {
          id: ride._id,
          rideId: ride.rideId,
          vehicleId: vehicle.vehicleId,
          startTime: ride.startTime,
          pricing: ride.pricing,
          cost: ride.cost
        },
        vehicle: {
          id: vehicle._id,
          vehicleId: vehicle.vehicleId,
          type: vehicle.type,
          model: vehicle.model,
          batteryLevel: vehicle.batteryLevel,
          maxSpeed: vehicle.maxSpeed,
          hasLock: vehicle.hasLock,
          lockType: vehicle.lockType
        }
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while unlocking vehicle'
    });
  }
});

// @desc    Report vehicle issue
// @route   POST /api/vehicles/:vehicleId/report
// @access  Private
router.post('/:vehicleId/report', protect, [
  body('issueType').isIn(['damage', 'battery', 'lock', 'location', 'safety', 'other']).withMessage('Valid issue type is required'),
  body('description').trim().isLength({ min: 10, max: 500 }).withMessage('Description must be between 10-500 characters'),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid severity level')
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

    const { vehicleId } = req.params;
    const { issueType, description, severity = 'medium', location } = req.body;

    const vehicle = await Vehicle.findOne({ vehicleId: vehicleId.toUpperCase() });

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Add maintenance note
    vehicle.maintenanceNotes.push({
      type: issueType === 'damage' ? 'repair' : 'other',
      description: `User Report: ${description}`,
      technician: `User: ${req.user.name} (${req.user.email})`
    });

    // Update vehicle status based on severity
    if (severity === 'critical' || severity === 'high') {
      vehicle.status = 'maintenance';
    }

    await vehicle.save();

    // TODO: Send notification to maintenance team

    res.status(200).json({
      success: true,
      message: 'Issue reported successfully. Thank you for helping us maintain our vehicles.',
      reportId: vehicle.maintenanceNotes[vehicle.maintenanceNotes.length - 1]._id
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while reporting issue'
    });
  }
});

// Admin routes for vehicle management
// @desc    Get all vehicles (Admin only)
// @route   GET /api/vehicles/admin/all
// @access  Private/Admin
router.get('/admin/all', protect, authorize('admin', 'super_admin'), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1-100'),
  query('status').optional().isIn(['available', 'in_use', 'maintenance', 'charging', 'damaged', 'lost']),
  query('type').optional().isIn(['scooter', 'bike']),
  query('zone').optional().isMongoId().withMessage('Invalid zone ID')
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
    if (req.query.status) query.status = req.query.status;
    if (req.query.type) query.type = req.query.type;
    if (req.query.zone) query.zone = req.query.zone;

    const vehicles = await Vehicle.find(query)
      .populate('zone', 'name city country')
      .populate('currentRide', 'rideId user startTime')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Vehicle.countDocuments(query);

    res.status(200).json({
      success: true,
      count: vehicles.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: vehicles
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching vehicles'
    });
  }
});

// @desc    Create new vehicle (Admin only)
// @route   POST /api/vehicles/admin/create
// @access  Private/Admin
router.post('/admin/create', protect, authorize('admin', 'super_admin'), [
  body('vehicleId').trim().isLength({ min: 3, max: 20 }).withMessage('Vehicle ID must be between 3-20 characters'),
  body('type').isIn(['scooter', 'bike']).withMessage('Type must be scooter or bike'),
  body('model').trim().notEmpty().withMessage('Model is required'),
  body('brand').trim().notEmpty().withMessage('Brand is required'),
  body('zone').isMongoId().withMessage('Valid zone ID is required'),
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('maxSpeed').isInt({ min: 1, max: 100 }).withMessage('Max speed must be between 1-100 km/h'),
  body('range').isInt({ min: 1, max: 200 }).withMessage('Range must be between 1-200 km'),
  body('weight').isFloat({ min: 1, max: 100 }).withMessage('Weight must be between 1-100 kg'),
  body('maxLoad').isFloat({ min: 50, max: 300 }).withMessage('Max load must be between 50-300 kg')
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

    const {
      vehicleId,
      type,
      model,
      brand,
      zone,
      latitude,
      longitude,
      address,
      maxSpeed,
      range,
      weight,
      maxLoad,
      hasLock = false,
      lockType
    } = req.body;

    // Check if vehicle ID already exists
    const existingVehicle = await Vehicle.findOne({ vehicleId: vehicleId.toUpperCase() });
    if (existingVehicle) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle with this ID already exists'
      });
    }

    // Verify zone exists
    const zoneDoc = await Zone.findById(zone);
    if (!zoneDoc) {
      return res.status(400).json({
        success: false,
        message: 'Zone not found'
      });
    }

    // Generate QR code
    const qrCode = `QR-${vehicleId.toUpperCase()}-${Date.now()}`;

    // Create vehicle
    const vehicle = await Vehicle.create({
      vehicleId: vehicleId.toUpperCase(),
      qrCode,
      type,
      model,
      brand,
      zone,
      location: {
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      },
      address,
      maxSpeed,
      range,
      weight,
      maxLoad,
      hasLock,
      lockType: hasLock ? lockType : undefined,
      pricing: {
        unlockFee: zoneDoc.pricing[type].unlockFee,
        perMinuteRate: zoneDoc.pricing[type].perMinuteRate,
        currency: zoneDoc.pricing.currency
      }
    });

    // Update zone vehicle count
    await Zone.findByIdAndUpdate(zone, {
      $inc: { currentVehicles: 1 }
    });

    res.status(201).json({
      success: true,
      message: 'Vehicle created successfully',
      data: vehicle
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating vehicle'
    });
  }
});

module.exports = router;
