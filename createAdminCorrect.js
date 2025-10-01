const mongoose = require('mongoose');
const Admin = require('./models/Admin');
require('dotenv').config();

const createAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mobility_platform');
    console.log('📦 Connected to MongoDB');

    // Delete existing admin users
    await Admin.deleteMany({ 
      email: { $in: ['admin@mobility.com', 'admin@scooters.modern-bns.com'] }
    });
    console.log('🗑️ Removed existing admin users');

    // Create new admin user with correct email from .env
    const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@scooters.modern-bns.com';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123456';

    const admin = new Admin({
      username: 'superadmin',
      email: adminEmail,
      password: adminPassword, // Will be hashed automatically by the pre-save hook
      role: 'super_admin',
      profile: {
        firstName: 'System',
        lastName: 'Administrator',
        phone: '+1234567890'
      },
      isActive: true
    });

    await admin.save();
    console.log('✅ Admin user created successfully in Admin model!');
    console.log(`📧 Email: ${adminEmail}`);
    console.log(`🔑 Password: ${adminPassword}`);
    console.log(`👤 Username: superadmin`);
    console.log(`🔐 Role: ${admin.role}`);
    console.log(`✅ Permissions set automatically based on role`);

    // Test the password
    const testAdmin = await Admin.findOne({ email: adminEmail }).select('+password');
    const isMatch = await testAdmin.comparePassword(adminPassword);
    console.log(`🧪 Password test: ${isMatch ? 'PASS ✅' : 'FAIL ❌'}`);

    // Display permissions
    console.log('\n📋 Admin permissions:');
    console.log(JSON.stringify(admin.permissions, null, 2));

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

createAdmin();