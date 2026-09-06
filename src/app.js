require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

morgan.token('body', (req) => (req.method === 'POST' ? JSON.stringify(req.body) : ''));

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const groupRoutes = require('./routes/group.routes');
const chapterRoutes = require('./routes/chapter.routes');
const topicRoutes = require('./routes/topic.routes');
const examRoutes = require('./routes/exam.routes');
const examPublicRoutes = require('./routes/examPublic.routes');
const normalExamRoutes = require('./routes/normalExam.routes');
const normalExamPublicRoutes = require('./routes/normalExamPublic.routes');
const surveyRoutes = require('./routes/survey.routes');
const surveyPublicRoutes = require('./routes/surveyPublic.routes');
const feedbackRatingRoutes = require('./routes/feedbackRating.routes');
const statsRoutes = require('./routes/stats.routes');
const uploadRoutes = require('./routes/upload.routes');

const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.use(
  cors({
    origin: process.env.CLIENT_URL || '*',
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(
  '/uploads',
  express.static(path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads'))
);

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/chapters', chapterRoutes);
app.use('/api/topics', topicRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/exam', examPublicRoutes);
app.use('/api/normal-exams', normalExamRoutes);
app.use('/api/normal-exam', normalExamPublicRoutes);
app.use('/api/surveys', surveyRoutes);
app.use('/api/survey', surveyPublicRoutes);
app.use('/api/feedback-rating', feedbackRatingRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/upload', uploadRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;