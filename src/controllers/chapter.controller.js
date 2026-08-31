const { ApiError } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Chapter = require('../models/Chapter');
const Topic = require('../models/Topic');
const Exam = require('../models/Exam');
const Question = require('../models/Question');
const Attempt = require('../models/Attempt');
const Session = require('../models/Session');

const listChapters = asyncHandler(async (req, res) => {
  const chapters = await Chapter.find().sort({ order: 1, createdAt: 1 });

  const topics = await Topic.find().select('chapter').lean();
  const exams = await Exam.find().select('topic isPublished').lean();

  const topicsByChapter = {};
  topics.forEach((t) => {
    const key = String(t.chapter);
    topicsByChapter[key] = (topicsByChapter[key] || 0) + 1;
  });

  const examsByTopic = {};
  const publishedByTopic = {};
  exams.forEach((e) => {
    const key = String(e.topic);
    examsByTopic[key] = (examsByTopic[key] || 0) + 1;
    if (e.isPublished) publishedByTopic[key] = true;
  });

  const data = chapters.map((c) => {
    const key = String(c._id);
    const topicCount = topicsByChapter[key] || 0;
    return {
      ...c.toObject(),
      topicsCount: topicCount,
      examsCount: topicCount ? (examsByTopic[key] || 0) : 0,
      publishedCount: topicCount ? (publishedByTopic[key] ? 1 : 0) : 0,
    };
  });

  res.json({ success: true, data });
});

const getChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) throw new ApiError(404, 'الفصل غير موجود');

  const topics = await Topic.find({ chapter: chapter._id }).sort({ order: 1, createdAt: 1 });
  res.json({ success: true, data: { ...chapter.toObject(), topics } });
});

const createChapter = asyncHandler(async (req, res) => {
  const { title, description, color, image, order } = req.body;
  if (!title) throw new ApiError(400, 'عنوان الفصل مطلوب');

  const chapter = await Chapter.create({
    title,
    description: description || '',
    color: color || '#722ed1',
    image: image || null,
    order: order || 0,
  });

  res.status(201).json({ success: true, data: chapter });
});

const updateChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) throw new ApiError(404, 'الفصل غير موجود');

  const { title, description, color, image, order, isActive } = req.body;
  if (title !== undefined) chapter.title = title;
  if (description !== undefined) chapter.description = description;
  if (color !== undefined) chapter.color = color;
  if (image !== undefined) chapter.image = image;
  if (order !== undefined) chapter.order = order;
  if (isActive !== undefined) chapter.isActive = isActive;

  await chapter.save();
  res.json({ success: true, data: chapter });
});

const deleteChapter = asyncHandler(async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) throw new ApiError(404, 'الفصل غير موجود');

  const topics = await Topic.find({ chapter: chapter._id }).select('_id');
  const examIds = await Exam.find({ topic: { $in: topics.map((t) => t._id) } }).select('_id');

  await Attempt.deleteMany({ exam: { $in: examIds.map((e) => e._id) } });
  await Session.deleteMany({ exam: { $in: examIds.map((e) => e._id) } });
  await Question.deleteMany({ exam: { $in: examIds.map((e) => e._id) } });
  await Exam.deleteMany({ _id: { $in: examIds.map((e) => e._id) } });
  await Topic.deleteMany({ chapter: chapter._id });
  await chapter.deleteOne();

  res.json({ success: true, message: 'تم حذف الفصل وكل ما بداخله' });
});

module.exports = { listChapters, getChapter, createChapter, updateChapter, deleteChapter };