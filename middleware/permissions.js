// middleware/permissions.js
const checkPermission = (module, action) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'غير مصرح لك بالوصول'
        });
      }

      // Super admin has all permissions
      if (req.user.role === 'super_admin') {
        return next();
      }

      // Check if user has the required permission
      const hasPermission = req.user.permissions?.[module]?.[action];
      
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: `ليس لديك صلاحية ${getActionName(action)} في ${getModuleName(module)}`
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({
        success: false,
        message: 'خطأ في التحقق من الصلاحيات'
      });
    }
  };
};

// Helper functions for Arabic names
const getModuleName = (module) => {
  const moduleNames = {
    dashboard: 'لوحة التحكم',
    users: 'المستخدمين',
    vehicles: 'المركبات',
    rides: 'الرحلات',
    zones: 'المناطق',
    payments: 'المدفوعات',
    reports: 'التقارير',
    settings: 'الإعدادات',
    admins: 'المشرفين'
  };
  return moduleNames[module] || module;
};

const getActionName = (action) => {
  const actionNames = {
    view: 'عرض',
    create: 'إنشاء',
    edit: 'تعديل',
    delete: 'حذف',
    export: 'تصدير',
    refund: 'استرداد',
    disable: 'تعطيل',
    maintenance: 'صيانة',
    tracking: 'تتبع',
    analytics: 'تحليلات',
    system: 'النظام',
    permissions: 'الصلاحيات'
  };
  return actionNames[action] || action;
};

module.exports = { checkPermission };