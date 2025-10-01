const express = require('express');
const { query, validationResult } = require('express-validator');
const Zone = require('../models/Zone');
const Vehicle = require('../models/Vehicle');
const { protect } = require('../middleware/auth');

const router = express.Router();

// @desc    Get all active zones
// @route   GET /api/locations/zones
// @access  Private
router.get('/zones', protect, async (req, res) => {
  try {
    const zones = await Zone.find({ isActive: true })
      .select('name city country center pricing operatingHours currentVehicles maxVehicles')
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: zones.length,
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

// @desc    Get zone by ID with detailed information
// @route   GET /api/locations/zones/:zoneId
// @access  Private
router.get('/zones/:zoneId', protect, async (req, res) => {
  try {
    const zone = await Zone.findById(req.params.zoneId);

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Zone not found'
      });
    }

    // Get vehicle count by status
    const vehicleStats = await Vehicle.aggregate([
      { $match: { zone: zone._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const stats = {};
    vehicleStats.forEach(stat => {
      stats[stat._id] = stat.count;
    });

    res.status(200).json({
      success: true,
      data: {
        ...zone.toObject(),
        vehicleStats: stats
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch zone details'
    });
  }
});

// @desc    Get zone pricing
// @route   GET /api/locations/zones/:zoneId/pricing
// @access  Private
router.get('/zones/:zoneId/pricing', protect, async (req, res) => {
  try {
    const zone = await Zone.findById(req.params.zoneId).select('pricing');

    if (!zone) {
      return res.status(404).json({
        success: false,
        message: 'Zone not found'
      });
    }

    res.status(200).json({
      success: true,
      data: zone.pricing
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch zone pricing'
    });
  }
});

// @desc    Find zones containing a point
// @route   GET /api/locations/zones/search
// @access  Private
router.get('/zones/search', protect, [
  query('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  query('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required')
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

    const { latitude, longitude } = req.query;
    const point = [parseFloat(longitude), parseFloat(latitude)];

    const zones = await Zone.find({
      isActive: true,
      boundaries: {
        $geoIntersects: {
          $geometry: {
            type: 'Point',
            coordinates: point
          }
        }
      }
    }).select('name city country pricing operatingHours parkingRules speedLimits');

    res.status(200).json({
      success: true,
      count: zones.length,
      data: zones
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to search zones'
    });
  }
});

// @desc    Get nearby zones
// @route   GET /api/locations/zones/nearby
// @access  Private
router.get('/zones/nearby', protect, [
  query('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  query('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  query('radius').optional().isFloat({ min: 0.1, max: 100 }).withMessage('Radius must be between 0.1 and 100 km')
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

    const { latitude, longitude, radius = 10 } = req.query;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    const searchRadius = parseFloat(radius);

    const zones = await Zone.find({
      isActive: true,
      center: {
        $geoWithin: {
          $centerSphere: [[lng, lat], searchRadius / 6371] // Convert km to radians
        }
      }
    }).select('name city country center pricing operatingHours currentVehicles maxVehicles');

    // Calculate distance for each zone
    const zonesWithDistance = zones.map(zone => {
      const distance = calculateDistance(
        lat, lng,
        zone.center.coordinates[1], zone.center.coordinates[0]
      );
      return {
        ...zone.toObject(),
        distance: Math.round(distance * 100) / 100 // Round to 2 decimal places
      };
    });

    // Sort by distance
    zonesWithDistance.sort((a, b) => a.distance - b.distance);

    res.status(200).json({
      success: true,
      count: zonesWithDistance.length,
      data: zonesWithDistance
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch nearby zones'
    });
  }
});

// @desc    Check if location is in allowed parking area
// @route   POST /api/locations/validate-parking
// @access  Private
router.post('/validate-parking', protect, [
  query('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  query('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required')
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

    const { latitude, longitude } = req.query;
    const point = [parseFloat(longitude), parseFloat(latitude)];

    // Find zone containing this point
    const zone = await Zone.findOne({
      isActive: true,
      boundaries: {
        $geoIntersects: {
          $geometry: {
            type: 'Point',
            coordinates: point
          }
        }
      }
    }).select('parkingRules');

    if (!zone) {
      return res.status(400).json({
        success: false,
        message: 'Location is outside service area',
        isValid: false
      });
    }

    let isValid = true;
    let penalty = 0;
    let reason = '';

    // Check forbidden areas
    if (zone.parkingRules.forbiddenAreas && zone.parkingRules.forbiddenAreas.length > 0) {
      for (const forbiddenArea of zone.parkingRules.forbiddenAreas) {
        // This would need proper geospatial query implementation
        // For now, we'll assume basic validation
        if (isPointInArea(point, forbiddenArea.boundaries)) {
          isValid = false;
          penalty = forbiddenArea.penalty || zone.parkingRules.penaltyForImproperParking || 0;
          reason = `Parking not allowed in ${forbiddenArea.name}`;
          break;
        }
      }
    }

    // Check if requires bike rack (simplified check)
    if (zone.parkingRules.requiresRack) {
      // In a real implementation, you would check against a database of bike rack locations
      // For now, we'll do a basic check
      const hasNearbyRack = await checkNearbyBikeRack(point);
      if (!hasNearbyRack) {
        isValid = false;
        penalty = zone.parkingRules.penaltyForImproperParking || 0;
        reason = 'Must park at designated bike rack';
      }
    }

    res.status(200).json({
      success: true,
      data: {
        isValid,
        penalty,
        reason,
        parkingRules: zone.parkingRules
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate parking location'
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

// Helper function to check if point is in area (simplified)
function isPointInArea(point, boundaries) {
  // This is a simplified implementation
  // In production, you would use proper geospatial libraries
  return false;
}

// Helper function to check nearby bike racks (placeholder)
async function checkNearbyBikeRack(point) {
  // This would check against a database of bike rack locations
  // For now, return true as a placeholder
  return true;
}

module.exports = router;
