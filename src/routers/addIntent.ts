/* istanbul ignore file */
import express from 'express';

import { generatePossibleIntent, generatePineconeRecords } from '../controllers/openai';
import { saveVectorToPinecone } from '../controllers/pinecone';
import { logger as customLogger } from '../utils/pinoLogger';

const log = customLogger(__filename);

export const router = express.Router();

router.post('/generate-intent', async (req, res) => {
  try {
    const messages = req.body;
    log.info({
      action: '/generate-intent',
      messages,
    });

    // dummy intent payload
    // const possibleIntentPayload = {
    //   visitorPrompts: [
    //     // Math.random(),
    //     'Lost my Universal card number, need to block it. How can I do this?',
    //     'I need to block my lost Universal card number. What is the process?',
    //     'How can I block my lost Universal card number?',
    //     'Want to block my lost Universal card number. What are the steps?',
    //     'Need help blocking a lost Universal card number.',
    //   ],
    //   operatorResponse:
    //     'Hello, I can assist you with blocking your card. To do so, please navigate to Menu - Cards - Freeze card.',
    // };
    const possibleIntentPayload = await generatePossibleIntent(messages);
    return res.json(possibleIntentPayload);
  } catch (e) {
    log.error({
      action: '/generate-intent',
      result: 'failure',
      e: e.stack,
    });
  }
});

router.post('/save-intent', async (req, res) => {
  try {
    const intent = req.body; // 5 visitor messages and 1 operator response
    log.info({ action: '/save-intent', intent });
    const pineconeRecords = await generatePineconeRecords(intent);
    await saveVectorToPinecone(pineconeRecords);
    return res.status(200).send({ status: 'success', message: 'Intent saved' });
  } catch (e) {
    log.error({
      action: '/save-intent',
      result: 'failure',
      e,
    });
  }
});
