const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { FEEDBACK_TYPE_LABELS } = require('../constants');
const Group = require('../models/Group');
const User = require('../models/User');

const listGroups = asyncHandler(async (req, res) => {
  const groups = await Group.find().sort({ createdAt: 1 });

  const counts = await User.aggregate([
    { $match: { role: 'student', group: { $ne: null } } },
    { $group: { _id: '$group', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));

  const data = groups.map((g) => ({
    ...g.toObject(),
    memberCount: countMap[String(g._id)] || 0,
    feedbackLabel: g.feedbackType ? FEEDBACK_TYPE_LABELS[g.feedbackType] : 'استخدام افتراضي الاختبار',
  }));

  res.json({ success: true, data });
});

const createGroup = asyncHandler(async (req, res) => {
  const { name, description, color, feedbackType } = req.body;
  if (!name) throw new ApiError(400, 'اسم المجموعة مطلوب');

  const group = await Group.create({
    name,
    description: description || '',
    color: color || '#1677ff',
    feedbackType: feedbackType || null,
  });

  res.status(201).json({ success: true, data: group });
});

const updateGroup = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) throw new ApiError(404, 'المجموعة غير موجودة');

  const { name, description, color, feedbackType, isActive } = req.body;

  if (name !== undefined) group.name = name;
  if (description !== undefined) group.description = description;
  if (color !== undefined) group.color = color;
  if (feedbackType !== undefined) group.feedbackType = feedbackType || null;
  if (isActive !== undefined) group.isActive = isActive;

  await group.save();
  res.json({ success: true, data: group });
});

const deleteGroup = asyncHandler(async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) throw new ApiError(404, 'المجموعة غير موجودة');

  await User.updateMany({ group: group._id }, { $set: { group: null } });
  await group.deleteOne();

  res.json({ success: true, message: 'تم حذف المجموعة. يستخدم طلابها الآن التغذية الرجعية الافتراضية للاختبار.' });
});

module.exports = { listGroups, createGroup, updateGroup, deleteGroup };