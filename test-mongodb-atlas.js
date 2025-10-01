require('dotenv').config();
const mongoose = require('mongoose');

async function testMongoDBAtlas() {
  try {
    console.log('🔄 جاري الاتصال بـ MongoDB Atlas...');
    
    // إخفاء كلمة المرور في السجل
    const connectionString = process.env.MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
    console.log('Connection String:', connectionString);
    
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ تم الاتصال بنجاح مع MongoDB Atlas!');
    console.log('📊 Database Name:', mongoose.connection.db.databaseName);
    console.log('🌐 Host:', mongoose.connection.host);
    
    // اختبار إنشاء مستند بسيط
    const testSchema = new mongoose.Schema({
      name: String,
      testType: String,
      createdAt: { type: Date, default: Date.now }
    });
    
    const TestModel = mongoose.model('AtlasTest', testSchema);
    
    const testDoc = new TestModel({
      name: 'MongoDB Atlas Connection Test',
      testType: 'connectivity_check'
    });
    
    await testDoc.save();
    console.log('✅ تم إنشاء مستند اختبار بنجاح!');
    console.log('📄 Test Document ID:', testDoc._id);
    
    // اختبار قراءة المستند
    const foundDoc = await TestModel.findById(testDoc._id);
    console.log('✅ تم قراءة المستند بنجاح!');
    console.log('📖 Found Document:', foundDoc.name);
    
    // تنظيف - حذف مستند الاختبار
    await TestModel.deleteOne({ _id: testDoc._id });
    console.log('✅ تم حذف مستند الاختبار بنجاح!');
    
    // إغلاق الاتصال
    await mongoose.connection.close();
    console.log('✅ تم إغلاق الاتصال بنجاح!');
    
    console.log('\n🎉 جميع الاختبارات نجحت! MongoDB Atlas جاهز للاستخدام.');
    
  } catch (error) {
    console.error('❌ فشل الاتصال مع MongoDB Atlas:');
    console.error('خطأ:', error.message);
    
    if (error.message.includes('authentication failed')) {
      console.log('\n💡 حلول مقترحة:');
      console.log('1. تأكد من صحة اسم المستخدم وكلمة المرور');
      console.log('2. تأكد من وجود Database User في Atlas');
      console.log('3. تأكد من صلاحيات Database User');
      console.log('4. استبدل <db_password> بكلمة المرور الفعلية');
    }
    
    if (error.message.includes('IP') || error.message.includes('network')) {
      console.log('\n💡 حل مشكلة الشبكة:');
      console.log('1. اذهب إلى Network Access في Atlas');
      console.log('2. أضف عنوان IP الخاص بك أو استخدم 0.0.0.0/0');
    }
    
    if (error.message.includes('ENOTFOUND')) {
      console.log('\n💡 حل مشكلة DNS:');
      console.log('1. تأكد من اتصال الإنترنت');
      console.log('2. تأكد من صحة cluster URL');
    }
    
    process.exit(1);
  }
}

console.log('🚀 بدء اختبار الاتصال مع MongoDB Atlas...\n');
testMongoDBAtlas();