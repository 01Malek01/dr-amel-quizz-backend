const express = require('express');
const {
  listNormalExams,
  getNormalExam,
  createNormalExam,
  updateNormalExam,
  setActive,
  deleteNormalExam,
  getNormalQuestions,
  setNormalQuestions,
  getNormalResults,
} = require('../controllers/normalExam.controller');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/', listNormalExams);
router.post('/', createNormalExam);
router.get('/:id', getNormalExam);
router.put('/:id', updateNormalExam);
router.delete('/:id', deleteNormalExam);
router.post('/:id/active', setActive);
router.get('/:id/questions', getNormalQuestions);
router.put('/:id/questions', setNormalQuestions);
router.get('/:id/results', getNormalResults);

module.exports = router;