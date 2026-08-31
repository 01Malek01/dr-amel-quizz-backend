const { ApiError } = require('../utils/ApiError');

const notFound = (req, res, next) =>
  next(new ApiError(404, `المسار غير موجود: ${req.originalUrl}`));

const errorHandler = (err, req, res, next) => {
  let status = err.statusCode || 500;
  let message = err.message || 'حدث خطأ غير متوقع في الخادم';

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

  res.status(status).json({ success: false, message });
};

module.exports = { notFound, errorHandler };