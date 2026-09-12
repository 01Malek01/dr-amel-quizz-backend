const { ApiError } = require('../utils/ApiError');

const notFound = (req, res, next) =>
  next(new ApiError(404, `المسار غير موجود: ${req.originalUrl}`));

const errorHandler = (err, req, res, next) => {
  // express.json() و multer يضعان الحالة في err.status لا err.statusCode
  let status = err.statusCode || err.status || 500;
  let message = err.message || 'حدث خطأ غير متوقع في الخادم';

  // جسم JSON تالف: نرد 400 برسالة مفهومة بدل رسالة الخطأ الداخلية
  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'صيغة البيانات المُرسلة غير صحيحة';
  }

  if (err.type === 'entity.too.large') {
    status = 413;
    message = 'حجم البيانات المُرسلة كبير جدًا';
  }

  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  }

  if (err.name === 'CastError') {
    status = 400;
    message = 'المعرّف المُدخل غير صالح';
  }

  if (err.code === 11000) {
    status = 409;
    message = `قيمة مكررة: ${Object.keys(err.keyValue || {}).join(', ')} يجب أن تكون فريدة`;
  }

  // لا نكشف تفاصيل الأخطاء غير المتوقعة للعميل، لكن نسجلها في الخادم
  if (status >= 500 && !err.isOperational) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[unhandled]', req.method, req.originalUrl, err);
    }
    message = 'حدث خطأ غير متوقع في الخادم';
  }

  res.status(status).json({ success: false, message });
};

module.exports = { notFound, errorHandler };