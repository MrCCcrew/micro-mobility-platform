const mongoose = require('mongoose');
const Admin = require('./models/Admin');
const User = require('./models/User');
require('dotenv').config();

const createAdminDirect = async () => {
  try {
    // Use the same connection string from your .env
    const mongoUri = process.env.MONGODB_URI;
    console.log('🔗 Connecting to MongoDB...');
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('📦 Connected to MongoDB successfully');

    const adminEmail = 'admin@scooters.modern-bns.com';
    const adminUsername = 'superadmin';
    
    // First, delete any existing admin users from both models by email AND username
    console.log('🗑️ Cleaning up existing admin users...');
    await User.deleteMany({ 
      $or: [
        { email: adminEmail },
        { username: adminUsername }
      ]
    });
    await Admin.deleteMany({ 
      $or: [
        { email: adminEmail },
        { username: adminUsername }
      ]
    });
    console.log('✅ Cleanup completed');

    // Create new admin user in Admin model
    console.log('👤 Creating new admin user in Admin model...');
    const admin = new Admin({
      username: adminUsername,
      email: adminEmail,
      password: 'admin123456',
      role: 'super_admin',
      profile: {
        firstName: 'System',
        lastName: 'Administrator',
        phone: '+1234567890'
      },
      isActive: true
    });

    await admin.save();
    console.log('✅ Admin user created successfully!');
    console.log(`📧 Email: ${adminEmail}`);
    console.log(`🔑 Password: admin123456`);
    console.log(`👤 Username: ${adminUsername}`);
    console.log(`🔐 Role: ${admin.role}`);

    // Verify the admin was created with permissions
    const createdAdmin = await Admin.findOne({ email: adminEmail });
    console.log('\n📋 Admin permissions structure:');
    console.log('Dashboard permissions:', createdAdmin.permissions.dashboard);
    console.log('Users permissions:', createdAdmin.permissions.users);
    console.log('Vehicles permissions:', createdAdmin.permissions.vehicles);

    console.log('\n🎉 Admin creation completed successfully!');
    console.log('📝 Next steps:');
    console.log('1. Restart your backend server');
    console.log('2. Clear browser cache/cookies');
    console.log('3. Login with the credentials above');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ENOTFOUND') {
      console.log('🌐 Network connection issue. Please check your internet connection.');
    }
    process.exit(1);
  }
};

createAdminDirect();