const mongoose = require('mongoose');
require('dotenv').config();

async function testConnection() {
    try {
        console.log('🔄 جاري الاتصال بـ MongoDB Atlas...');
        console.log('Connection String:', process.env.MONGODB_URI.replace(/:[^:@]*@/, ':***@'));
        
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ تم الاتصال بنجاح مع MongoDB Atlas!');
        console.log('📊 معلومات قاعدة البيانات:');
        console.log('- Database Name:', mongoose.connection.db.databaseName);
        console.log('- Connection State:', mongoose.connection.readyState);
        
        // اختبار إنشاء مجموعة بسيطة
        const testCollection = mongoose.connection.db.collection('test');
        await testCollection.insertOne({ test: 'connection successful', timestamp: new Date() });
        console.log('✅ تم اختبار الكتابة بنجاح!');
        
        // حذف البيانات التجريبية
        await testCollection.deleteOne({ test: 'connection successful' });
        console.log('✅ تم اختبار الحذف بنجاح!');
        
    } catch (error) {
        console.log('❌ فشل الاتصال مع MongoDB Atlas:');
        console.log('خطأ:', error.message);
        
        if (error.message.includes('authentication failed')) {
            console.log('\n💡 حلول مقترحة:');
            console.log('1. تأكد من صحة اسم المستخدم وكلمة المرور في Atlas');
            console.log('2. تأكد من وجود Database User في Atlas');
            console.log('3. تأكد من صلاحيات Database User');
            console.log('4. تحقق من Network Access في Atlas');
        }
    } finally {
        await mongoose.disconnect();
        console.log('🔌 تم قطع الاتصال');
        process.exit(0);
    }
}

testConnection();