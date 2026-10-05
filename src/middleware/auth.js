const { ApiError } = require('../utils/ApiError');
const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token = null;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new ApiError(401, 'يرجى تسجيل الدخول للمتابعة'));
  }

  try {
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return next(new ApiError(401, 'الحساب غير موجود أو معطّل'));
    }
    req.user = user;
    next();
  } catch (error) {
    next(new ApiError(401, 'انتهت صلاحية جلستك. يرجى تسجيل الدخول مجددًا'));
  }
};

// يقرأ المستخدم إن أرسل توكنًا، ولا يرفض الزائر: لصفحات يراها الجميع
// ويتغيّر محتواها إن كان صاحب الطلب مسجّل الدخول (مثل استثناء الطالب المتأخر)
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer')) return next();

  try {
    const decoded = verifyToken(header.split(' ')[1]);
    const user = await User.findById(decoded.id);
    if (user && user.isActive) req.user = user;
  } catch {
    // توكن منتهٍ أو تالف: يُعامل صاحبه كزائر
  }
  next();
};

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(new ApiError(403, 'للمديرين فقط'));
  }
  next();
};

module.exports = { protect, optionalAuth, adminOnly };