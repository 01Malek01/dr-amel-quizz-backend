const express = require('express');
const {
  overview,
  byFeedback,
  examsStats,
  studentsStats,
  examDetail,
  perStudentExam,
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

module.exports = router;