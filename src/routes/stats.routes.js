const express = require('express');
const {
  overview,
  byFeedback,
  examsStats,
  studentsStats,
  examDetail,
  perStudentExam,
  feedbackRatings,
  postSurveyResults,
} = require('../controllers/stats.controller');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/overview', overview);
router.get('/by-feedback', byFeedback);
router.get('/exams', examsStats);
router.get('/exams/:id', examDetail);
router.get('/students', studentsStats);
router.get('/per-student-exam', perStudentExam);
router.get('/feedback-ratings', feedbackRatings);
router.get('/post-survey', postSurveyResults);

module.exports = router;