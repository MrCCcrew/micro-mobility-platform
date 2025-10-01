const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

const createAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mobility_platform');
    console.log('📦 Connected to MongoDB');

    // Delete existing admin users
    await User.deleteMany({ 
      email: { $in: ['admin@mobility.com', 'admin@scooters.modern-bns.com'] }
    });
    console.log('🗑️ Removed existing admin users');

    // Create new admin user with correct email from .env
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@scooters.modern-bns.com';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123456';

    const admin = new User({
      name: 'System Administrator',
      email: adminEmail,
      phone: '+1234567890',
      password: adminPassword, // Will be hashed automatically by the pre-save hook
      role: 'super_admin',
      isVerified: true,
      isActive: true,
      preferences: {
        language: 'en',
        currency: 'USD'
      }
    });

    await admin.save();
    console.log('✅ Admin user created successfully!');
    console.log(`📧 Email: ${adminEmail}`);
    console.log(`🔑 Password: ${adminPassword}`);

    // Test the password
    const testUser = await User.findOne({ email: adminEmail }).select('+password');
    const isMatch = await testUser.matchPassword(adminPassword);
    console.log(`🧪 Password test: ${isMatch ? 'PASS ✅' : 'FAIL ❌'}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

createAdmin();

