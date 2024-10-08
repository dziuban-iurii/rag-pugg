import { pinecone } from '../services/pinecone';
import { logger as customLogger } from '../utils/pinoLogger';
import { config } from '../config';

const log = customLogger(__filename);

export type Match = {
  text: string;
  score: number;
};

export enum PineconeDocType {
  RaiseToSupport = 'raise_to_support',
  KnowledgeBase = 'knowledge_base',
  SmallTalk = 'small_talk',
}

export type PineconeMatchMetadata = {
  text: string;
  data_type: PineconeDocType;
};

export type PineconeMatchType = {
  id: string;
  score: number;
  values: number[];
  sparseValues?: number | undefined;
  metadata: PineconeMatchMetadata;
};

export type RelevantMatchesWithVectorType = {
  relevantMatches: Match[] | [];
  embeddings: number[];
};

export type RelevantKbAndHandoverMatchesWithVectorType = {
  relevantMatchesKb: Match[] | [];
  relevantMatchesHandovers: Match[] | [];
  embeddings: number[];
};

type PineconeMetadata = {
  request: string;
  response: string;
};

export type PineconeRecord = {
  id: string;
  values: number[];
  metadata: PineconeMetadata;
};

export const saveVectorToPinecone = async (records: PineconeRecord[]) => {
  try {
    // might want to check for duplicates here
    await pinecone.upsert(records);
  } catch (error) {
    log.error({
      action: 'saveVectorToPinecone',
      result: 'failure',
      e: error.stack,
    });
  }
};

export const getTopRelevantDocsByVector = async (
  vector: number[],
  filter?: object, // { "data_type": { "$eq": "raise_to_support" } }
  similarityScoreLimitOverride?: number,
): Promise<RelevantMatchesWithVectorType> => {
  try {
    const queryRequest: object = {
      vector,
      topK: config.TOP_K ?? 3,
      includeMetadata: true,
      includeValues: true,
      ...(filter && { filter }),
    };

    const { matches } = await pinecone.query(queryRequest);
    const relevantMatches = [];
    const minScore = similarityScoreLimitOverride ? similarityScoreLimitOverride : config.SIMILARITY_SEARCH_LIMIT;
    for (const match of matches) {
      if (match.score >= minScore) {
        relevantMatches.push({
          score: match?.score,
          text: match?.metadata?.response,
        });
      }
    }

    return {
      embeddings: vector,
      relevantMatches,
    };
  } catch (error) {
    log.error({
      action: 'getTopRelevantDocsByVector',
      result: 'failure',
      e: error,
    });
  }
};

export const getContextsAndHandoverTriggersByVector = async (
  vector: number[],
  kbSimilaritySearchLimit = 0.85,
  handoverSimilaritySearchLimit = 0.9,
): Promise<RelevantKbAndHandoverMatchesWithVectorType> => {
  try {
    const queryRequest: any = {
      vector,
      topK: config.TOP_K * 2,
      includeMetadata: true,
      includeValues: true,
      filter: { customer: { $eq: 'demo' } },
    };

    const { matches } = await pinecone.query({ queryRequest });
    const relevantMatchesHandoverContexts = matches
      .filter(
        (match: PineconeMatchType) =>
          match.metadata['data_type'] === PineconeDocType.RaiseToSupport &&
          match.score >= handoverSimilaritySearchLimit,
      )
      .slice(0, 5);
    const relevantMatchesKbOrSmalltalkContexts = matches
      .filter(
        (match: PineconeMatchType) =>
          match.metadata['data_type'] === PineconeDocType.KnowledgeBase && match.score >= kbSimilaritySearchLimit,
      )
      .slice(0, 5);

    const relevantMatchesHandovers = [];
    const relevantMatchesKb = [];

    for (const context of relevantMatchesHandoverContexts) {
      relevantMatchesHandovers.push({
        score: context.score,
        text: context.metadata.text,
      });
    }

    for (const context of relevantMatchesKbOrSmalltalkContexts) {
      relevantMatchesKb.push({
        score: context.score,
        text: context.metadata.text,
      });
    }

    return {
      embeddings: vector,
      relevantMatchesKb,
      relevantMatchesHandovers,
    };
  } catch (error) {
    log.error({
      action: 'getContextsAndHandoverTriggersByVector',
      result: 'failure',
      e: error.stack,
    });
  }
};
