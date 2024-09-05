import { Pinecone } from '@pinecone-database/pinecone';

import { logger as customLogger } from '../../utils/pinoLogger';
import { config } from '../../config';

const log = customLogger(__filename);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let pineconeClient: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let pinecone: any;

export const initPinecone = async () => {
  log.info({
    action: 'pineconeInit',
    result: 'starting',
    pineconeIndexName: config.PINECONE_INDEX_NAME,
    environment: config.PINECONE_ENVIRONMENT,
    apiKey: config.PINECONE_API_KEY.slice(0, 5),
  });
  try {
    pineconeClient = new Pinecone({
      apiKey: config.PINECONE_API_KEY,
    });
    log.info({
      action: 'pineconeInit',
      result: 'success',
      msg: 'initialized pinecone',
    });
  } catch (error) {
    log.error({
      action: 'pineconeInit',
      result: 'failure',
      e: error,
    });
  }
};

(async () => {
  await initPinecone();
  pinecone = pineconeClient.index(config.PINECONE_INDEX_NAME);
})();
