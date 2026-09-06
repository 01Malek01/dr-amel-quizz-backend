const express = require('express');
const {
  getMeta,
  getQuestions,
  submit,
} = require('../controllers/surveyPublic.controller');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/:code', getMeta);
router.get('/:code/questions', protect, getQuestions);
router.post('/:code/submit', protect, submit);

module.exports = router;