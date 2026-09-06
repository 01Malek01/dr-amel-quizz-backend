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

const clean = (value) => {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s ? s.toLowerCase() : undefined;
};

const createUser = asyncHandler(async (req, res) => {
  const { name, username, email, nationalId, password, group, role = 'student', isActive } = req.body;

  if (!name || !password) {
    throw new ApiError(400, 'الاسم الكامل وكلمة المرور مطلوبان');
  }

  const safeUsername = clean(username);
  const safeEmail = clean(email);
  const safeNationalId = clean(nationalId);

  const data = {
    name,
    username: safeUsername,
    email: safeEmail,
    nationalId: safeNationalId,
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

  const set = {};
  const unset = {};

  if (name !== undefined) set.name = String(name).trim();
  if (password) set.password = password;
  if (group !== undefined) set.group = group || null;
  if (isActive !== undefined) set.isActive = isActive;

  if (username !== undefined) {
    const v = String(username).trim().toLowerCase();
    if (v) set.username = v;
    else unset.username = '';
  }
  if (email !== undefined) {
    const v = String(email).trim().toLowerCase();
    if (v) set.email = v;
    else unset.email = '';
  }
  if (nationalId !== undefined) {
    const v = String(nationalId).trim();
    if (v) set.nationalId = v;
    else unset.nationalId = '';
  }

  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;

  const updated = await User.findByIdAndUpdate(req.params.id, update, {
    new: true,
    runValidators: true,
  }).populate('group');

  res.json({ success: true, data: toSafeUser(updated) });
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