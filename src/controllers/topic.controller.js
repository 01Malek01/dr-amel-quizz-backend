const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { escapeRegex } = require('../utils/escapeRegex');
const Topic = require('../models/Topic');
const Chapter = require('../models/Chapter');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');

const listTopics = asyncHandler(async (req, res) => {
  const { chapter = '', search = '' } = req.query;

  const filter = {};
  if (chapter) filter.chapter = chapter;
  if (search.trim()) filter.title = { $regex: escapeRegex(search.trim()), $options: 'i' };

  const topics = await Topic.find(filter).sort({ order: 1, createdAt: 1 });
  const exams = await Exam.find().select('topic').lean();

  const examCountByTopic = {};
  exams.forEach((e) => {
    const key = String(e.topic);
    examCountByTopic[key] = (examCountByTopic[key] || 0) + 1;
  });

  const data = topics.map((t) => ({
    ...t.toObject(),
    examsCount: examCountByTopic[String(t._id)] || 0,
  }));

  res.json({ success: true, data });
});

const createTopic = asyncHandler(async (req, res) => {
  const { chapter, title, description, order } = req.body;
  if (!chapter) throw new ApiError(400, 'اختر فصلًا لهذا الموضوع');
  if (!title) throw new ApiError(400, 'عنوان الموضوع مطلوب');

  const chapterDoc = await Chapter.findById(chapter);
  if (!chapterDoc) throw new ApiError(404, 'الفصل غير موجود');

  const topic = await Topic.create({
    chapter,
    title,
    description: description || '',
    order: order || 0,
  });

  res.status(201).json({ success: true, data: topic });
});

const updateTopic = asyncHandler(async (req, res) => {
  const topic = await Topic.findById(req.params.id);
  if (!topic) throw new ApiError(404, 'الموضوع غير موجود');

  const { title, description, order, isActive, chapter } = req.body;
  if (title !== undefined) topic.title = title;
  if (description !== undefined) topic.description = description;
  if (order !== undefined) topic.order = order;
  if (isActive !== undefined) topic.isActive = isActive;
  if (chapter !== undefined) {
    const chapterDoc = await Chapter.findById(chapter);
    if (!chapterDoc) throw new ApiError(404, 'الفصل غير موجود');
    topic.chapter = chapter;
  }

  await topic.save();
  res.json({ success: true, data: topic });
});

const deleteTopic = asyncHandler(async (req, res) => {
  const topic = await Topic.findById(req.params.id);
  if (!topic) throw new ApiError(404, 'الموضوع غير موجود');

  const examIds = await Exam.find({ topic: topic._id }).select('_id');

  await Attempt.deleteMany({ exam: { $in: examIds.map((e) => e._id) } });
  await Session.deleteMany({ exam: { $in: examIds.map((e) => e._id) } });
  await Question.deleteMany({ exam: { $in: examIds.map((e) => e._id) } });
  await Exam.deleteMany({ _id: { $in: examIds.map((e) => e._id) } });
  await topic.deleteOne();

  res.json({ success: true, message: 'تم حذف الموضوع واختباراته' });
});

module.exports = { listTopics, createTopic, updateTopic, deleteTopic };