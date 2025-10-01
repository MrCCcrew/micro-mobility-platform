const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');
const Zone = require('../models/Zone');
const Vehicle = require('../models/Vehicle');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mobility_platform', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected for seeding');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

const seedUsers = async () => {
  try {
    // Clear existing users
    await User.deleteMany({});

    // Create admin user
    const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123456', 10);
    const admin = new User({
      name: 'System Administrator',
      email: process.env.ADMIN_EMAIL || 'admin@mobility.com',
      phone: '+1234567890',
      password: adminPassword,
      role: 'super_admin',
      isVerified: true,
      preferences: {
        language: 'en',
        currency: 'USD'
      }
    });

    await admin.save();
    console.log('✅ Admin user created');

    // Create some test users
    const testUsers = [
      {
        name: 'John Doe',
        email: 'john@test.com',
        phone: '+1234567891',
        password: await bcrypt.hash('password123', 10),
        role: 'user',
        isVerified: true,
        preferences: {
          language: 'en',
          currency: 'USD'
        }
      },
      {
        name: 'Ahmed Hassan',
        email: 'ahmed@test.com',
        phone: '+201234567890',
        password: await bcrypt.hash('password123', 10),
        role: 'user',
        isVerified: true,
        preferences: {
          language: 'ar',
          currency: 'EGP'
        }
      },
      {
        name: 'Sarah Smith',
        email: 'sarah@test.com',
        phone: '+1234567892',
        password: await bcrypt.hash('password123', 10),
        role: 'user',
        isVerified: true,
        preferences: {
          language: 'en',
          currency: 'USD'
        }
      }
    ];

    await User.insertMany(testUsers);
    console.log('✅ Test users created');
  } catch (error) {
    console.error('Error seeding users:', error);
  }
};

const seedZones = async () => {
  try {
    // Clear existing zones
    await Zone.deleteMany({});

    const zones = [
      {
        name: 'Downtown Cairo',
        city: 'Cairo',
        country: 'Egypt',
        boundaries: {
          type: 'Polygon',
          coordinates: [[
            [31.2257, 30.0626], // Southwest
            [31.2457, 30.0626], // Southeast
            [31.2457, 30.0826], // Northeast
            [31.2257, 30.0826], // Northwest
            [31.2257, 30.0626]  // Close polygon
          ]]
        },
        center: {
          coordinates: [31.2357, 30.0726]
        },
        isActive: true,
        maxVehicles: 200,
        operatingHours: {
          start: '05:00',
          end: '23:00',
          timezone: 'Africa/Cairo'
        },
        pricing: {
          scooter: {
            unlockFee: 5.0,
            perMinuteRate: 1.5
          },
          bike: {
            unlockFee: 3.0,
            perMinuteRate: 1.0
          },
          currency: 'EGP',
          dayRental: {
            scooter: {
              dailyRate: 150.0,
              minimumDays: 2,
              deliveryFee: 25.0
            },
            bike: {
              dailyRate: 100.0,
              minimumDays: 2,
              deliveryFee: 20.0
            }
          }
        },
        parkingRules: {
          allowedAreas: [],
          forbiddenAreas: [],
          requiresRack: false,
          penaltyForImproperParking: 25.0
        }
      },
      {
        name: 'Dubai Marina',
        city: 'Dubai',
        country: 'UAE',
        boundaries: {
          type: 'Polygon',
          coordinates: [[
            [55.1290, 25.0700], // Southwest
            [55.1490, 25.0700], // Southeast
            [55.1490, 25.0900], // Northeast
            [55.1290, 25.0900], // Northwest
            [55.1290, 25.0700]  // Close polygon
          ]]
        },
        center: {
          coordinates: [55.1390, 25.0800]
        },
        isActive: true,
        maxVehicles: 150,
        operatingHours: {
          start: '06:00',
          end: '00:00',
          timezone: 'Asia/Dubai'
        },
        pricing: {
          scooter: {
            unlockFee: 3.0,
            perMinuteRate: 0.75
          },
          bike: {
            unlockFee: 2.0,
            perMinuteRate: 0.50
          },
          currency: 'AED',
          dayRental: {
            scooter: {
              dailyRate: 75.0,
              minimumDays: 2,
              deliveryFee: 15.0
            },
            bike: {
              dailyRate: 50.0,
              minimumDays: 2,
              deliveryFee: 10.0
            }
          }
        },
        parkingRules: {
          allowedAreas: [],
          forbiddenAreas: [],
          requiresRack: true,
          penaltyForImproperParking: 50.0
        }
      },
      {
        name: 'Central London',
        city: 'London',
        country: 'UK',
        boundaries: {
          type: 'Polygon',
          coordinates: [[
            [-0.1500, 51.5000], // Southwest
            [-0.1000, 51.5000], // Southeast
            [-0.1000, 51.5200], // Northeast
            [-0.1500, 51.5200], // Northwest
            [-0.1500, 51.5000]  // Close polygon
          ]]
        },
        center: {
          coordinates: [-0.1250, 51.5100]
        },
        isActive: true,
        maxVehicles: 300,
        operatingHours: {
          start: '05:00',
          end: '23:30',
          timezone: 'Europe/London'
        },
        pricing: {
          scooter: {
            unlockFee: 1.0,
            perMinuteRate: 0.20
          },
          bike: {
            unlockFee: 1.0,
            perMinuteRate: 0.15
          },
          currency: 'GBP',
          dayRental: {
            scooter: {
              dailyRate: 25.0,
              minimumDays: 2,
              deliveryFee: 5.0
            },
            bike: {
              dailyRate: 15.0,
              minimumDays: 2,
              deliveryFee: 3.0
            }
          }
        },
        parkingRules: {
          allowedAreas: [],
          forbiddenAreas: [],
          requiresRack: true,
          penaltyForImproperParking: 25.0
        }
      }
    ];

    const createdZones = await Zone.insertMany(zones);
    console.log('✅ Zones created:', createdZones.length);
    return createdZones;
  } catch (error) {
    console.error('Error seeding zones:', error);
    return [];
  }
};

const seedVehicles = async (zones) => {
  try {
    // Clear existing vehicles
    await Vehicle.deleteMany({});

    const vehicles = [];
    const vehicleTypes = ['scooter', 'bike'];
    const brands = {
      scooter: ['Xiaomi', 'Ninebot', 'Bird', 'Lime'],
      bike: ['Trek', 'Giant', 'Specialized', 'Cannondale']
    };
    const models = {
      scooter: ['Pro 2', 'Max G30', 'ES4', 'City'],
      bike: ['Urban', 'City Cruiser', 'Commuter', 'Metro']
    };

    zones.forEach((zone, zoneIndex) => {
      const vehicleCount = 20; // 20 vehicles per zone
      
      for (let i = 0; i < vehicleCount; i++) {
        const type = vehicleTypes[i % 2]; // Alternate between scooter and bike
        const brand = brands[type][Math.floor(Math.random() * brands[type].length)];
        const model = models[type][Math.floor(Math.random() * models[type].length)];
        
        // Generate random location within zone bounds
        const bounds = zone.boundaries.coordinates[0];
        const minLng = Math.min(...bounds.map(coord => coord[0]));
        const maxLng = Math.max(...bounds.map(coord => coord[0]));
        const minLat = Math.min(...bounds.map(coord => coord[1]));
        const maxLat = Math.max(...bounds.map(coord => coord[1]));
        
        const randomLng = minLng + Math.random() * (maxLng - minLng);
        const randomLat = minLat + Math.random() * (maxLat - minLat);
        
        const vehicleId = `${type.toUpperCase().substr(0, 2)}${String(zoneIndex + 1).padStart(2, '0')}${String(i + 1).padStart(3, '0')}`;
        
        vehicles.push({
          vehicleId,
          qrCode: `QR-${vehicleId}-${Date.now()}`,
          type,
          model,
          brand,
          zone: zone._id,
          location: {
            coordinates: [randomLng, randomLat]
          },
          address: `${zone.city}, ${zone.country}`,
          status: Math.random() > 0.2 ? 'available' : 'maintenance', // 80% available
          batteryLevel: Math.floor(Math.random() * 40) + 60, // 60-100%
          maxSpeed: type === 'scooter' ? 25 : 20,
          range: type === 'scooter' ? 30 : 50,
          weight: type === 'scooter' ? 12.5 : 15.0,
          maxLoad: type === 'scooter' ? 100 : 120,
          pricing: {
            unlockFee: zone.pricing[type].unlockFee,
            perMinuteRate: zone.pricing[type].perMinuteRate,
            currency: zone.pricing.currency
          },
          hasLock: type === 'bike',
          lockType: type === 'bike' ? 'cable' : undefined,
          isActive: true,
          iot: {
            deviceId: `IOT-${vehicleId}`,
            firmwareVersion: '1.2.3',
            lastHeartbeat: new Date(),
            gpsAccuracy: Math.floor(Math.random() * 5) + 3, // 3-8 meters
            signalStrength: Math.floor(Math.random() * 30) + 70 // 70-100%
          }
        });
      }
    });

    await Vehicle.insertMany(vehicles);
    console.log('✅ Vehicles created:', vehicles.length);

    // Update zone vehicle counts
    for (const zone of zones) {
      const count = vehicles.filter(v => v.zone.toString() === zone._id.toString()).length;
      await Zone.findByIdAndUpdate(zone._id, { currentVehicles: count });
    }
    
    console.log('✅ Zone vehicle counts updated');
  } catch (error) {
    console.error('Error seeding vehicles:', error);
  }
};

const seedDatabase = async () => {
  console.log('🌱 Starting database seeding...');
  
  await connectDB();
  
  await seedUsers();
  const zones = await seedZones();
  await seedVehicles(zones);
  
  console.log('✅ Database seeding completed!');
  console.log('\n📋 Admin Credentials:');
  console.log(`Email: ${process.env.ADMIN_EMAIL || 'admin@mobility.com'}`);
  console.log(`Password: ${process.env.ADMIN_PASSWORD || 'admin123456'}`);
  console.log('\n📋 Test User Credentials:');
  console.log('Email: john@test.com, Password: password123');
  console.log('Email: ahmed@test.com, Password: password123');
  console.log('Email: sarah@test.com, Password: password123');
  
  process.exit(0);
};

// Run seeding if this file is executed directly
if (require.main === module) {
  seedDatabase().catch(error => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
}

module.exports = { seedDatabase };
