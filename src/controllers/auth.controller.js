const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken } = require('../utils/jwt');
const { toSafeUser } = require('../utils/serialize');
const User = require('../models/User');

const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  const value = String(identifier || '').trim();

  if (!value || !password) {
    throw new ApiError(400, 'أدخل بيانات الدخول وكلمة المرور');
  }

  const user = await User.findByLoginIdentifier(value);
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'بيانات الدخول أو كلمة المرور غير صحيحة. حاول مجددًا.');
  }

  if (!user.isActive) {
    throw new ApiError(403, 'هذا الحساب غير نشط. يرجى مراجعة المسؤول.');
  }

  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });

  const token = signToken(user);
  const populated = await User.findById(user._id).populate('group');

  res.json({ success: true, token, user: toSafeUser(populated) });
});

const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('group');
  res.json({ success: true, user: toSafeUser(user) });
});

module.exports = { login, me };