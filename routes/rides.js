const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Ride = require('../models/Ride');
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// @desc    Get user's rides
// @route   GET /api/rides
// @access  Private
router.get('/', protect, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1-50'),
  query('status').optional().isIn(['active', 'completed', 'cancelled'])
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
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { user: req.user.id };
    if (req.query.status) {
      query.status = req.query.status;
    }

    const rides = await Ride.find(query)
      .populate('vehicle', 'vehicleId type model batteryLevel images')
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
      message: 'Server error while fetching rides'
    });
  }
});

// @desc    Get current active ride
// @route   GET /api/rides/active
// @access  Private
router.get('/active', protect, async (req, res) => {
  try {
    const activeRide = await Ride.findOne({
      user: req.user.id,
      status: 'active'
    }).populate('vehicle', 'vehicleId type model batteryLevel location maxSpeed hasLock lockType images');

    if (!activeRide) {
      return res.status(404).json({
        success: false,
        message: 'No active ride found'
      });
    }

    res.status(200).json({
      success: true,
      data: activeRide
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching active ride'
    });
  }
});

// @desc    Get ride by ID
// @route   GET /api/rides/:rideId
// @access  Private
router.get('/:rideId', protect, async (req, res) => {
  try {
    const ride = await Ride.findOne({
      $or: [
        { _id: req.params.rideId },
        { rideId: req.params.rideId }
      ],
      user: req.user.id
    }).populate('vehicle', 'vehicleId type model brand images');

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    res.status(200).json({
      success: true,
      data: ride
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching ride'
    });
  }
});

// @desc    Update ride location (during active ride)
// @route   PUT /api/rides/:rideId/location
// @access  Private
router.put('/:rideId/location', protect, [
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  body('speed').optional().isFloat({ min: 0, max: 100 }).withMessage('Speed must be between 0-100 km/h'),
  body('batteryLevel').optional().isInt({ min: 0, max: 100 }).withMessage('Battery level must be between 0-100')
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

    const { latitude, longitude, speed = 0, batteryLevel } = req.body;

    const ride = await Ride.findOne({
      $or: [
        { _id: req.params.rideId },
        { rideId: req.params.rideId }
      ],
      user: req.user.id,
      status: 'active'
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Active ride not found'
      });
    }

    // Add location to route
    const locationPoint = {
      location: {
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      },
      speed: parseFloat(speed)
    };

    if (batteryLevel !== undefined) {
      locationPoint.batteryLevel = parseInt(batteryLevel);
    }

    ride.route.push(locationPoint);

    // Update max speed
    if (speed > ride.maxSpeed) {
      ride.maxSpeed = speed;
    }

    // Calculate distance if we have previous points
    if (ride.route.length > 1) {
      const prevPoint = ride.route[ride.route.length - 2];
      const distance = calculateDistance(
        prevPoint.location.coordinates[1], prevPoint.location.coordinates[0],
        latitude, longitude
      );
      ride.distance += distance;
    }

    await ride.save();

    // Update vehicle location and battery
    const vehicle = await Vehicle.findById(ride.vehicle);
    if (vehicle) {
      vehicle.location.coordinates = [parseFloat(longitude), parseFloat(latitude)];
      if (batteryLevel !== undefined) {
        vehicle.batteryLevel = parseInt(batteryLevel);
      }
      await vehicle.save();

      // Emit real-time update
      const io = req.app.get('io');
      io.emit('vehicle-location-updated', {
        vehicleId: vehicle.vehicleId,
        location: vehicle.location,
        batteryLevel: vehicle.batteryLevel,
        rideId: ride.rideId
      });
    }

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        distance: ride.distance,
        maxSpeed: ride.maxSpeed,
        routePoints: ride.route.length
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating location'
    });
  }
});

// @desc    Pause ride
// @route   POST /api/rides/:rideId/pause
// @access  Private
router.post('/:rideId/pause', protect, [
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  body('reason').optional().isIn(['user_pause', 'battery_low', 'maintenance', 'other'])
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

    const { latitude, longitude, reason = 'user_pause' } = req.body;

    const ride = await Ride.findOne({
      $or: [
        { _id: req.params.rideId },
        { rideId: req.params.rideId }
      ],
      user: req.user.id,
      status: 'active'
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Active ride not found'
      });
    }

    // Add pause record
    ride.pauses.push({
      startTime: new Date(),
      location: {
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      },
      reason
    });

    ride.status = 'paused';
    await ride.save();

    res.status(200).json({
      success: true,
      message: 'Ride paused successfully',
      data: {
        pauseId: ride.pauses[ride.pauses.length - 1]._id,
        pausedAt: ride.pauses[ride.pauses.length - 1].startTime
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while pausing ride'
    });
  }
});

// @desc    Resume ride
// @route   POST /api/rides/:rideId/resume
// @access  Private
router.post('/:rideId/resume', protect, async (req, res) => {
  try {
    const ride = await Ride.findOne({
      $or: [
        { _id: req.params.rideId },
        { rideId: req.params.rideId }
      ],
      user: req.user.id,
      status: 'paused'
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Paused ride not found'
      });
    }

    // End the last pause
    const lastPause = ride.pauses[ride.pauses.length - 1];
    if (lastPause && !lastPause.endTime) {
      lastPause.endTime = new Date();
    }

    ride.status = 'active';
    await ride.save();

    res.status(200).json({
      success: true,
      message: 'Ride resumed successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while resuming ride'
    });
  }
});

// @desc    End ride
// @route   POST /api/rides/:rideId/end
// @access  Private
router.post('/:rideId/end', protect, [
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  body('address').optional().trim().isLength({ max: 200 }).withMessage('Address must be less than 200 characters'),
  body('parkingPhotoUrl').optional().isURL().withMessage('Invalid parking photo URL')
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

    const { latitude, longitude, address, parkingPhotoUrl } = req.body;

    const ride = await Ride.findOne({
      $or: [
        { _id: req.params.rideId },
        { rideId: req.params.rideId }
      ],
      user: req.user.id,
      status: { $in: ['active', 'paused'] }
    }).populate('vehicle');

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Active ride not found'
      });
    }

    // End any active pause
    if (ride.status === 'paused') {
      const lastPause = ride.pauses[ride.pauses.length - 1];
      if (lastPause && !lastPause.endTime) {
        lastPause.endTime = new Date();
      }
    }

    // Set end location and time
    ride.endLocation = {
      coordinates: [parseFloat(longitude), parseFloat(latitude)],
      address: address || 'Location not specified'
    };
    ride.endTime = new Date();
    ride.status = 'completed';

    // Calculate final metrics
    ride.calculateAvgSpeed();
    const totalCost = ride.calculateCost();

    await ride.save();

    // Update vehicle status
    const vehicle = await Vehicle.findById(ride.vehicle._id);
    if (vehicle) {
      vehicle.status = 'available';
      vehicle.currentRide = null;
      vehicle.location.coordinates = [parseFloat(longitude), parseFloat(latitude)];
      vehicle.totalRides += 1;
      vehicle.totalDistance += ride.distance;
      vehicle.totalRevenue += totalCost;
      await vehicle.save();

      // Emit real-time update
      const io = req.app.get('io');
      io.emit('vehicle-status-changed', {
        vehicleId: vehicle.vehicleId,
        status: 'available',
        location: vehicle.location
      });
    }

    // Update user stats
    const user = await User.findById(req.user.id);
    if (user) {
      user.totalDistance += ride.distance;
      user.totalSpent += totalCost;
      await user.save();
    }

    // TODO: Process payment here
    ride.payment.status = 'completed';
    ride.payment.paidAt = new Date();
    await ride.save();

    res.status(200).json({
      success: true,
      message: 'Ride ended successfully',
      data: {
        rideId: ride.rideId,
        duration: ride.duration,
        distance: ride.distance,
        cost: ride.cost,
        endLocation: ride.endLocation,
        avgSpeed: ride.avgSpeed,
        maxSpeed: ride.maxSpeed
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while ending ride'
    });
  }
});

// @desc    Rate and review ride
// @route   POST /api/rides/:rideId/review
// @access  Private
router.post('/:rideId/review', protect, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1-5'),
  body('feedback').optional().trim().isLength({ max: 500 }).withMessage('Feedback must be less than 500 characters')
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

    const { rating, feedback } = req.body;

    const ride = await Ride.findOne({
      $or: [
        { _id: req.params.rideId },
        { rideId: req.params.rideId }
      ],
      user: req.user.id,
      status: 'completed'
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Completed ride not found'
      });
    }

    if (ride.rating) {
      return res.status(400).json({
        success: false,
        message: 'Ride has already been rated'
      });
    }

    ride.rating = rating;
    ride.feedback = feedback || '';
    await ride.save();

    res.status(200).json({
      success: true,
      message: 'Thank you for your feedback!',
      data: {
        rating: ride.rating,
        feedback: ride.feedback
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while submitting review'
    });
  }
});

// Helper function to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in km
}

module.exports = router;
