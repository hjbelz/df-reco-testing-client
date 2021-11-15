// setup environment with dotenv
const dotenv = require('dotenv'); // must be a node-style require!
dotenv.config();
const TESTING_PATH = process.env.DF_RECO_TESTING_PATH;
const FIXED_CONTEXT_NAME = process.env.FIXED_CONTEXT_NAME;
const PROJECT_ID = process.env.PROJECT_ID;
const LANGUAGE_CODE = process.env.LANGUAGE_CODE;;

// setup loggin with Winston 
import { createLogger, format, transports,  } from 'winston';
import { format as fns_format }  from 'date-fns';

const messageOnlyFormat = format.printf(({ level, message, durationMs }) => { 
  if (durationMs) {
    return `-- Duration of ${message}: ${durationMs} ms`;  
  } else {
    return `${message}`;
  }
});

const logfileName = `Reco_${FIXED_CONTEXT_NAME}_${fns_format(new Date(), "yyyy-MM-dd_HH-mm-ss")}.log`;

const logger = createLogger({
  level: 'info',
  transports: [
    new transports.Console({ format: messageOnlyFormat }),
    new transports.File({ filename: logfileName, format: messageOnlyFormat })
  ]
});


// TODO Check whether all mandatory config variables are properly set

// Some useful info
logger.info(`-- Connecting to project ${process.env.PROJECT_ID} with language code ${process.env.LANGUAGE_CODE} .`);
logger.debug(`-- Connecting with credentials from ${process.env.GOOGLE_APPLICATION_CREDENTIALS}.`);
// log.info(`Testing audio files in path ${process.env.DF_RECO_TESTING_PATH}.`);

// Google Dialogflow dependencies
import dialogflow = require('@google-cloud/dialogflow');
import uuid = require('uuid');

import fs = require('fs');
import util = require('util');
import path = require('path');

import { Struct, struct } from 'pb-util';
import winston = require('winston');

// See https://www.smashingmagazine.com/2021/01/dialogflow-agent-react-application/#handling-voice-inputs
// See https://github.com/googleapis/gax-nodejs/blob/main/client-libraries.md#creating-the-client-instance
// See https://github.com/savelee/kube-django-ng/blob/master/chatserver/src/dialogflow.ts

// TODO Fixed Context: Starting a new session for every request vs. just resetting the context



/**
 * A future log entry for caching.
 */

interface LogEntry {
  level: string;
  message: string;
}

/**
 * Caches log statements of a test for later.
 */
class LogCache {
  logEntryMap = new Map<string, LogEntry[]>();

  addLogEntry(identifier: string, logEntry: LogEntry) {

    let logEntriesOfTest = this.logEntryMap.get(identifier);
    
    if (logEntriesOfTest === undefined) {
      logEntriesOfTest = [];
      this.logEntryMap.set(identifier, logEntriesOfTest);  
    }

    logEntriesOfTest.push(logEntry);
  }

  info(identifier: string, message: string) {
    this.addLogEntry(identifier, { level: "info", message: message } );
  }

  debug(identifier: string, message: string) {
    this.addLogEntry(identifier, { level: "debug", message: message } );
  }

  error(identifier: string, message: string) {
    this.addLogEntry(identifier, { level: "error", message: message } );
  }

  processEntries(processor: (logEntry: LogEntry) => void  ) {

    logger.debug(`\n\n-- Processing cached log entries for ${this.logEntryMap.size} audio files:`);

    let keys = Array.from( this.logEntryMap.keys() );
    keys.sort();
    for (let key of keys) {
      let nextLogEntries = this.logEntryMap.get(key);
      for (let nextlogEntry of nextLogEntries) {
        processor(nextlogEntry);
      }
    }
  }
}

async function detectAudioIntent(
  projectId: string,
  logCacheTests : LogCache,
  sessionId: string,
  filename: string,
  encoding: dialogflow.protos.google.cloud.dialogflow.v2.AudioEncoding,
  sampleRateHertz: number,
  languageCode: string,
  
  fixedContext?: string
) {
  // Instantiates a session client
  const sessionClient = new dialogflow.SessionsClient();

  // The path to identify the agent that owns the created intent.
  const sessionPath = sessionClient.projectAgentSessionPath(
    projectId,
    sessionId
  );

  // Read the content of the audio file and send it as part of the request.
  const readFile = util.promisify(fs.readFile);
  const inputAudio = await readFile(filename);
  const request: dialogflow.protos.google.cloud.dialogflow.v2.IDetectIntentRequest = {
    session: sessionPath,
    queryParams: {},
    queryInput: {
      audioConfig: {
        audioEncoding: encoding,
        sampleRateHertz: sampleRateHertz,
        languageCode: languageCode,
      },
    },
    inputAudio: inputAudio,
  };

  // optionally, set a fixed context 
  if (fixedContext) {
    request.queryParams.contexts = [
      {
        name: `projects/${projectId}/agent/sessions/${sessionId}/contexts/${fixedContext.toLowerCase()}`, // somebody loves REST URLs
        lifespanCount: 5 // TODO Make flexible
      }
    ];
    request.queryParams.resetContexts = true;  // Resetting all contexts, if context should be fixed.
  }

  // Recognizes the speech in the audio and detects its intent.
  const [response] = await sessionClient.detectIntent(request);

  // TODO: Collect results over all tests in a hash map before logging to ensure alphabetical order?
  let audioFileName = path.basename(filename);
  logCacheTests.info(audioFileName, `\n--- Response for audio file ${audioFileName} -----------------------`);
  const result = response.queryResult;
  // Instantiates a context client
  const contextClient = new dialogflow.ContextsClient();

  logCacheTests.info(audioFileName, `   🎤 Query: ${result.queryText}`);
  logCacheTests.info(audioFileName, `   🔈 Response: ${result.fulfillmentText}`);
  if (result.intent) {
    let intentEmoji = result.intent.isFallback ? "🧨" : "💡";
    logCacheTests.info(audioFileName, `   ${intentEmoji} Intent: ${result.intent.displayName} (${result.intentDetectionConfidence})`);
  } else {
    logCacheTests.info(audioFileName, '   🐞 No intent matched.');
  }

  const parameters = JSON.stringify(struct.decode(result.parameters as Struct));
  logCacheTests.info(audioFileName, `  Parameters: ${parameters}`);
  logCacheTests.debug(audioFileName, `  Session ID: ${sessionId}`);

  /* TODO Format output context and make optional.
  if (result.outputContexts && result.outputContexts.length) {
    log.info('  Output contexts:');
    result.outputContexts.forEach((context: { name?: string; parameters?: any; lifespanCount?: number; }) => {
      const contextId = contextClient.matchContextFromProjectAgentSessionContextName(
        context.name
      );

      let contextParameters = "NONE";
      if (context.parameters) {
        const contextParameters = JSON.stringify(
          struct.decode(context.parameters)
        );
      }
      log.info(`    ${contextId}`);
      log.info(`      lifespan: ${context.lifespanCount}`);
      log.info(`      parameters: ${contextParameters}`);
    });
  } 
  */
}

async function runSingleSample(filename: string, logCacheTests: LogCache, sessionId = uuid.v4(), audioEncoding = dialogflow.protos.google.cloud.dialogflow.v2.AudioEncoding.AUDIO_ENCODING_FLAC) {

    // TODO Make fixed intent and other parameters more accessible and flexible
    if (FIXED_CONTEXT_NAME) {
      return detectAudioIntent(PROJECT_ID, logCacheTests, sessionId, filename, audioEncoding, 44100, LANGUAGE_CODE, FIXED_CONTEXT_NAME);
    } else {
      return detectAudioIntent(PROJECT_ID, logCacheTests, sessionId, filename, audioEncoding, 44100, LANGUAGE_CODE);
    }
}

async function runAllSamplesInPath(filepath: string, logCacheTests: LogCache) {

  logger.info(`-- Reading audio files from folder ${filepath}`);

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(filepath, { withFileTypes: true });
    let initialAudioFile: string = null;
    let audioFileCounter = 0;
    const audioFileNames: string[] = [];

    for (const dirEntry of dirEntries) {

      if (dirEntry.isFile && path.extname(dirEntry.name) == ".flac") {

        if (dirEntry.name.startsWith("_initial")) {
          initialAudioFile = dirEntry.name;
          logger.info("Using " + dirEntry.name + " as initial utterance.");

        } else {
          audioFileNames.push(dirEntry.name);
          audioFileCounter++;
        }

      } else {
        logger.debug("❌ Ignored dir entry " + dirEntry.name);
      }
    }
    logger.info(`-- Added ${audioFileCounter} files to the test.`);


    logger.debug(`-- Sorting audio files ...`);
    audioFileNames.sort();

    // TODO Initial audio files will not work properly with async execution 
    let sessionId = uuid.v4();
    if (initialAudioFile) {
      await runSingleSample(filepath + "/" + initialAudioFile, logCacheTests, sessionId);
    }

    let testFuncs = [];
    for (const audioFileName of audioFileNames) {

      // If there is no initial audio file, all samples are send to inidvidual sessions 
      if (!initialAudioFile) {
        sessionId = uuid.v4();
      }

      logger.debug(`Reading audio from file '${audioFileName}'.`);
      testFuncs.push(runSingleSample(filepath + "/" + audioFileName,logCacheTests, sessionId));
    }

    // wait for the promises of all test runs to resolve
    return Promise.all(testFuncs);

  } catch (err) {
    logger.error(err);
  }
}

async function execTestsAndWait(testSamplePath: string) {

  let logCacheTests = new LogCache();

  const testRunDurationProfiler = logger.startTimer();
  await runAllSamplesInPath(testSamplePath, logCacheTests);
  testRunDurationProfiler.done({message: "test run"});

  // log cached test run messages
  logCacheTests.processEntries((logEntry: LogEntry) => {
    logger.log(logEntry.level, logEntry.message);
  });
}

execTestsAndWait(TESTING_PATH);

// runSample([TESTING_PATH + "/mein-vorname-ist-heinz.flac"]);


