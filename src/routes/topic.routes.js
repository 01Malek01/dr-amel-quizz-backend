const express = require('express');
const {
  listTopics,
  createTopic,
  updateTopic,
  deleteTopic,
} = require('../controllers/topic.controller');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/', listTopics);
router.post('/', createTopic);
router.put('/:id', updateTopic);
router.delete('/:id', deleteTopic);

module.exports = router;