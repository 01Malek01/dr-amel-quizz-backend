const express = require('express');
const {
  listSurveys,
  getSurvey,
  getTemplate,
  createSurvey,
  updateSurvey,
  setActive,
  deleteSurvey,
  getResults,
} = require('../controllers/survey.controller');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/', listSurveys);
router.get('/template', getTemplate);
router.post('/', createSurvey);
router.get('/:id', getSurvey);
router.put('/:id', updateSurvey);
router.delete('/:id', deleteSurvey);
router.post('/:id/active', setActive);
router.get('/:id/results', getResults);

module.exports = router;