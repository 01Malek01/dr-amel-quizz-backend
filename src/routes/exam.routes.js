const express = require('express');
const {
  listExams,
  getExam,
  createExam,
  updateExam,
  publishExam,
  unpublishExam,
  deleteExam,
} = require('../controllers/exam.controller');
const {
  getQuestions,
  setQuestions,
} = require('../controllers/question.controller');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/', listExams);
router.post('/', createExam);
router.get('/:id', getExam);
router.put('/:id', updateExam);
router.delete('/:id', deleteExam);
router.post('/:id/publish', publishExam);
router.post('/:id/unpublish', unpublishExam);
router.get('/:id/questions', getQuestions);
router.put('/:id/questions', setQuestions);

module.exports = router;