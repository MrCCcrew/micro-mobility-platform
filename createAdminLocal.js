const bcrypt = require('bcryptjs');

const createLocalAdmin = async () => {
  try {
    console.log('🔐 Creating local admin credentials...');
    
    const adminEmail = 'admin@scooters.modern-bns.com';
    const adminPassword = 'admin123456';
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    
    console.log('✅ Admin credentials generated:');
    console.log(`📧 Email: ${adminEmail}`);
    console.log(`🔑 Password: ${adminPassword}`);
    console.log(`🔒 Hashed Password: ${hashedPassword}`);
    
    // Test password verification
    const isMatch = await bcrypt.compare(adminPassword, hashedPassword);
    console.log(`🧪 Password verification: ${isMatch ? 'PASS ✅' : 'FAIL ❌'}`);
    
    console.log('\n📋 Use these credentials to login:');
    console.log(`Email: ${adminEmail}`);
    console.log(`Password: ${adminPassword}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
};

createLocalAdmin();