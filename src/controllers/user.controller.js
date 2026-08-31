const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { toSafeUser } = require('../utils/serialize');
const User = require('../models/User');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');

const listUsers = asyncHandler(async (req, res) => {
  const { search = '', groupId = '', role = 'student' } = req.query;

  const filter = {};
  if (role && role !== 'all') filter.role = role;
  if (groupId) filter.group = groupId;

  if (search.trim()) {
    const regex = new RegExp(search.trim(), 'i');
    filter.$or = [
      { name: regex },
      { username: regex },
      { email: regex },
      { nationalId: regex },
    ];
  }

  const users = await User.find(filter).populate('group').sort({ createdAt: -1 });
  res.json({ success: true, data: users.map(toSafeUser) });
});

const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate('group');
  if (!user) throw new ApiError(404, 'المستخدم غير موجود');
  res.json({ success: true, data: toSafeUser(user) });
});

const createUser = asyncHandler(async (req, res) => {
  const { name, username, email, nationalId, password, group, role = 'student', isActive } = req.body;

  if (!name || !password) {
    throw new ApiError(400, 'الاسم الكامل وكلمة المرور مطلوبان');
  }

  const hasEmail = email ? String(email).trim() : '';
  const hasUsername = username ? String(username).trim() : '';
  const hasNationalId = nationalId ? String(nationalId).trim() : '';

  if (!hasEmail && !hasUsername && !hasNationalId) {
    throw new ApiError(400, 'أضف واحدًا على الأقل من: رقم التعريف، البريد الإلكتروني، أو اسم المستخدم');
  }

  const resolvedUsername =
    hasUsername ||
    (hasEmail ? hasEmail.toLowerCase().split('@')[0] : null);

  const data = {
    name,
    username: resolvedUsername?.toLowerCase(),
    email: hasEmail ? hasEmail.toLowerCase() : undefined,
    nationalId: hasNationalId || undefined,
    password,
    role,
    group: group || null,
    isActive: isActive === undefined ? true : isActive,
  };

  Object.keys(data).forEach((key) => data[key] === undefined && delete data[key]);

  const user = await User.create(data);
  const populated = await User.findById(user._id).populate('group');
  res.status(201).json({ success: true, data: toSafeUser(populated) });
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'المستخدم غير موجود');

  const { name, username, email, nationalId, password, group, isActive } = req.body;

  if (name !== undefined) user.name = name;
  if (username !== undefined) user.username = String(username).trim().toLowerCase() || null;
  if (email !== undefined) user.email = String(email).trim().toLowerCase() || null;
  if (nationalId !== undefined) user.nationalId = String(nationalId).trim() || null;
  if (group !== undefined) user.group = group || null;
  if (isActive !== undefined) user.isActive = isActive;
  if (password) user.password = password;

  await user.save();
  const populated = await User.findById(user._id).populate('group');
  res.json({ success: true, data: toSafeUser(populated) });
});

const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'المستخدم غير موجود');
  if (user.role === 'admin') {
    throw new ApiError(400, 'لا يمكن حذف حسابات المديرين');
  }

  await Attempt.deleteMany({ user: user._id });
  await Session.deleteMany({ user: user._id });
  await user.deleteOne();

  res.json({ success: true, message: 'تم حذف المستخدم وسجلات اختباراته' });
});

module.exports = { listUsers, getUser, createUser, updateUser, deleteUser };