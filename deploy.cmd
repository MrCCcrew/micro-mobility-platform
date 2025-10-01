@echo off
echo ========================================
echo    نشر الباك إند على HostGator
echo ========================================

echo.
echo 1. تنظيف الملفات المؤقتة...
if exist node_modules rmdir /s /q node_modules
if exist *.log del *.log
if exist backend.zip del backend.zip

echo.
echo 2. تثبيت الحزم للإنتاج...
npm install --production

echo.
echo 3. إنشاء أرشيف للنشر...
powershell -Command "Compress-Archive -Path *, -DestinationPath backend-deploy.zip -Force -Exclude node_modules, .git, *.log, test-*.js, createAdmin*.js, twilio_verify_selftest.js, backups, sftp-config.json, deploy.cmd"

echo.
echo 4. الملفات جاهزة للنشر!
echo    - استخدم SFTP لرفع الملفات
echo    - أو استخدم backend-deploy.zip
echo.

echo 5. خطوات النشر على HostGator:
echo    a. ارفع الملفات إلى: /home4/y0d2lyn6/nodeapps/scooters-api
echo    b. في cPanel، اذهب إلى Node.js Apps
echo    c. أنشئ تطبيق Node.js جديد:
echo       - Node.js Version: 18.x أو أحدث
echo       - Application Root: nodeapps/scooters-api
echo       - Application URL: scooters-api
echo       - Application Startup File: server.js
echo    d. في Environment Variables، أضف:
echo       NODE_ENV=production
echo    e. انسخ محتوى .env.production إلى متغيرات البيئة
echo    f. اضغط على "Create"
echo.

echo ========================================
echo           النشر مكتمل!
echo ========================================
pause