import { logger as customLogger } from '../utils/pinoLogger';
import { Message, Role } from '../services/openai/types';
import { getChatCompletion, getEmbeddingsForString, generateEmbedding, getAiCompletion } from '../services/openai';
import { saveConversationEntry } from '../db';
import { getContextsAndHandoverTriggersByVector } from './pinecone';
import { getTopRelevantDocsByVector } from './pinecone';
import { v4 as uuidv4 } from 'uuid';

const log = customLogger(__filename);

const prompts = {
  qnaPrompt: {
    systemMessageSmallTalk: `
    You are an experienced and professional customer service agent of ExampleShop, tasked with kindly responding to customer inquiries.

    Give the answer in markdown format. Always answer in English. Keep your answers concise.

    Determine if user's message belongs to the small talk categories specified below and delimited by +++++.

    If user message does NOT belong to these defined small talk categories, respond "I haven't found relevant info in my knowledge base. Let me please pass you to a live agent". Otherwise politely respond and ask the user about the subject of their question.

    +++++Small Talk categories:
    Greeting: User message simply contains greetings, for example hi, hello, good morning
    Farewell: User is saying goodbye, e.g. bye, see you
    Thanks: User simply expresses gratitude, e.g. thanks, tnx
    Profanity: User message contains swear words, obscene language, e.g. what the fuck
    Affirmative: User simply responds with a confirmation, such as yes, sure
    Negative: User responds wit a denial, e.g. no+++++
    `,
    systemMessageQnA: `
    You are an experienced and professional customer service agent of ExampleShop, tasked with kindly responding to customer inquiries.
    Give the answer in markdown format. Always answer in English. Keep your answers concise.

    You only know the information provided in the VECTOR_CONTEXT. Do not make up any info which is not present in VECTOR_CONTEXT.
    If VECTOR_CONTEXT doesn't provide enough details to answer user's question, ask the user to provide more details or rephrase the question.
    Generate each response based on the following VECTOR_CONTEXT: <context>

    If VECTOR_CONTEXT references any resources (addresses, links, phone numbers, lists), include them in the ANSWER.
    `,
  },
  processVisitorMessage: `You are an expert in analyzing bank support desk queries. Your task is to clean up the visitor's query by removing filler words, repetitions, and any Personally Identifiable Information (PII), such as names, addresses, and numbers. After cleaning up the original query, generate four alternative prompts that visitors could use to ask for the same thing. Respond with an array containing 5 visitor queries, without any additional explanations or phrases like 'Cleaned Query' or 'Alternative Prompts'.

  Visitor Input:

  "[VISITOR MESSAGES]"`,
  processOperatorMessage: `You are an expert in analyzing bank support desk queries. Your task is to clean up the response which operator sent to the visitor by removing filler words, greetings, repetitions, and any Personally Identifiable Information (PII), such as names, addresses, and numbers. Rephrase the response in a more professional way. Respond with the final processed operator's message. Don't put your answer in quotes.

  Original operator's response:

  "[OPERATOR MESSAGES]"`,
  getSuggestion: `
    You are a professional customer service agent at a financial institution, tasked with kindly responding to customer inquiries.
    Respond concisely to customer inquiries in English, based strictly on the information provided in VECTOR_CONTEXT.

    Do not create any information outside of what is in VECTOR_CONTEXT.
    Don't put your answer in quotes.

    Generate each response based on the following VECTOR_CONTEXT:
    "[VECTOR_CONTEXT]"

    Visitor's question is:
    "[VISITOR_QUERY]".
    `,
};

export const getHandleSmallTalkPrompt = (query: string): Message[] => {
  try {
    const contextEnhancedSystemMessage = prompts.qnaPrompt.systemMessageSmallTalk;

    const messages = [
      {
        role: Role.system,
        content: contextEnhancedSystemMessage,
      },
      {
        role: Role.user,
        content: query,
      },
    ];

    return messages;
  } catch (err) {
    log.error({
      action: 'getHandleSmallTalkPrompt',
      result: 'failure',
      e: err.stack,
    });
  }
};

export const getQnAPrompt = (context: string, query: string): Message[] => {
  try {
    const contextEnhancedSystemMessage = prompts.qnaPrompt.systemMessageQnA.replace('<context>', context);

    const messages = [
      {
        role: Role.system,
        content: contextEnhancedSystemMessage,
      },
      {
        role: Role.user,
        content: query,
      },
    ];

    return messages;
  } catch (err) {
    log.error({
      action: 'getQnAPrompt',
      result: 'failure',
      e: err.stack,
    });
  }
};

export enum GliaSenderType {
  visitor = 'visitor',
  operator = 'operator',
  system = 'system',
}

export type GliaMsgSender = {
  id: string;
  type: GliaSenderType;
};

export type GliaMessage = {
  id: string;
  content: string;
  sender: GliaMsgSender;
};

export type IntentPayload = {
  visitorPrompts: string[];
  operatorResponse: string;
};

/**
 * LLM is expected to respond with a stringified array of 5 visitor prompts.
 * This response may contain new line characters (\n), and also backslashes which
 * escape double quotes.
 */
const parseStrArrToMessages = (strArr: string): string[] | string => {
  const withoutNewLines = strArr.replace(/\n/g, '');
  const withoutEscapedQuotes = withoutNewLines.replace(/\\/g, '');
  try {
    return JSON.parse(withoutEscapedQuotes);
  } catch (err) {
    log.error({
      action: 'parseStrArrToMessages',
      result: 'failure',
      e: err.stack,
    });
    return strArr;
  }
};

/**
 * Uses LLM to remove any possible PII, filler words, repetitions and
 * determine the main intent of the visitor. Then generates 4 alternative
 * prompts
 */
const processVisitorMessages = async (messages: string[]): Promise<string[]> => {
  const prompt = prompts.processVisitorMessage.replace('[VISITOR MESSAGES]', messages.join(' '));
  log.info({ action: 'processVisitorMessages: prompt', prompt });

  const requestMessages = [
    {
      role: Role.user,
      content: prompt,
    },
  ];
  const visitorPromptsStrArr = await getAiCompletion(requestMessages);
  const visitorPrompts = parseStrArrToMessages(visitorPromptsStrArr);
  return visitorPrompts as string[];
};

/**
 * Uses LLM to remove any possible PII, filler words, repetitions, and
 * rephrase the operator's response in a more professional way
 */
const processOperatorMessages = async (messages: string[]): Promise<string> => {
  const prompt = prompts.processOperatorMessage.replace('[OPERATOR MESSAGES]', messages.join(' '));
  log.info({ action: 'processOperatorMessages: prompt', prompt });

  const requestMessages = [
    {
      role: Role.user,
      content: prompt,
    },
  ];
  const operatorResponseProcessed = await getAiCompletion(requestMessages);
  return operatorResponseProcessed;
};

/**
 * Uses LLM to respond to visitor's message based on the context
 * retrieved from the vector DB
 */
const respondBasedOnContext = async ({ query, context }: { query: string; context: string }): Promise<string> => {
  const prompt = prompts.getSuggestion.replace('[VISITOR_QUERY]', query).replace('[VECTOR_CONTEXT]', context);
  log.info({ action: 'respondBasedOnContext: prompt', prompt });

  const requestMessages = [
    {
      role: Role.user,
      content: prompt,
    },
  ];
  const suggestion = await getAiCompletion(requestMessages);
  return suggestion;
};

/**
 * Accepts a "conversation turn" (a list comprised of visitor's message(s) and operator's response(s)),
 * processes them (cleans from PII, filler words, repetitions etc), generates 4 alternative visitor
 * prompts, and returns the resulting visitor prompts and operator's response.
 */
export const generatePossibleIntent = async (messages: GliaMessage[]): Promise<IntentPayload> => {
  const visitorMessages = messages
    .filter((message) => message.sender?.type === GliaSenderType.visitor)
    .map((message) => message.content);
  const operatorMessages = messages
    .filter((message) => message.sender?.type === GliaSenderType.operator)
    .map((message) => message.content);
  const visitorPrompts = await processVisitorMessages(visitorMessages);
  const operatorResponse = await processOperatorMessages(operatorMessages);
  return {
    visitorPrompts,
    operatorResponse,
  };
};

/**
 * Accepts the possible intent (5 visitor's prompts and 1 operator's response),
 * generates embeddings for them (for each of the 4 generated visitor prompts +
 * for the combination of the original visitor prompts and the operator's response),
 * generates IDs for the Pinecone records, and returns the ready payloads. Sample payload:
 * { id: '123', values: [0.1, 0.2, 0.3, 0.4], metadata: { text: '<operator response>' } }
 */
export const generatePineconeRecords = async (intent: any) => {
  try {
    const { visitorPrompts, operatorResponse } = intent;
    const textsToEmbed = [`${visitorPrompts[0]} ${operatorResponse}`, ...visitorPrompts.slice(1)];
    const embeddings = await Promise.all(textsToEmbed.map((text) => generateEmbedding(text)));
    // iterate over embeddings and their indexes
    const payloads = [];
    for (let i = 0; i < embeddings.length; i++) {
      payloads.push({
        id: uuidv4(),
        values: embeddings[i],
        metadata: {
          request: textsToEmbed[i],
          response: operatorResponse,
        },
      });
    }
    log.info({ action: 'generatePineconeRecords', result: 'success' });
    return payloads;
  } catch (err) {
    log.error({
      action: 'generatePineconeRecords',
      result: 'failure',
      e: err.stack,
    });
  }
};

/**
 * Expects visitor message, generates a suggestion for an operator using
 * RAG (generates embeddings for the visitor message, searches for semantically
 * similar messages in the Pinecone index, and if found, generates response
 * using this message)
 */
export const generateSuggestion = async (visitorMsg: any) => {
  try {
    const vector = await generateEmbedding(visitorMsg.content ?? '');
    const { relevantMatches = [] } = await getTopRelevantDocsByVector(vector);

    if (relevantMatches.length === 0) {
      log.info({ action: 'generateSuggestion', result: 'no relevant matches found' });
      return false;
    }

    const suggestionBasedOnContext = await respondBasedOnContext({
      query: visitorMsg.content,
      context: relevantMatches[0].text,
    });
    log.info({ action: 'generateSuggestion', suggestionBasedOnContext, score: relevantMatches[0].score });
    return {
      text: suggestionBasedOnContext,
      score: relevantMatches[0].score,
      context: relevantMatches[0].text,
    };
  } catch (err) {
    log.error({
      action: 'generateSuggestion',
      result: 'failure',
      e: err,
    });
  }
};
