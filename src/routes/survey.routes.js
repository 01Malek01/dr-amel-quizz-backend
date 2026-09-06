const express = require('express');
const {
  listSurveys,
  getSurvey,
  createSurvey,
  updateSurvey,
  setActive,
  deleteSurvey,
  setQuestions,
  getResults,
} = require('../controllers/survey.controller');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/', listSurveys);
router.post('/', createSurvey);
router.get('/:id', getSurvey);
router.put('/:id', updateSurvey);
router.delete('/:id', deleteSurvey);
router.post('/:id/active', setActive);
router.put('/:id/questions', setQuestions);
router.get('/:id/results', getResults);

module.exports = router;