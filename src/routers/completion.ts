/* istanbul ignore file */
import express from 'express';
import { generateSuggestion } from '../controllers/openai';
import { logger as customLogger } from '../utils/pinoLogger';

const log = customLogger(__filename);

export const router = express.Router();

router.post('/suggestion', async (req, res) => {
  try {
    const suggestionData = await generateSuggestion(req.body);
    return res.json(suggestionData);
  } catch (e) {
    log.error({
      action: '/suggestion',
      result: 'failure',
      e,
    });
  }
});
