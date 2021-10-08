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
    return `Duration of ${message}: ${durationMs} ms`;  
  } else {
    return `${message}`;
  }
});

const logfileName = `DF-RecoTest ${fns_format(new Date(), "yyyy-MM-dd_HH-mm-ss")}.log`;

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


async function detectAudioIntent(
  projectId: string,
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
  logger.info(`\n--- Response for audio file ${path.basename(filename)} -----------------------`);
  const result = response.queryResult;
  // Instantiates a context client
  const contextClient = new dialogflow.ContextsClient();

  logger.info(`   🎤 Query: ${result.queryText}`);
  logger.info(`   🔈 Response: ${result.fulfillmentText}`);
  if (result.intent) {
    let intentEmoji = result.intent.isFallback ? "🧨" : "💡";
    logger.info(`   ${intentEmoji} Intent: ${result.intent.displayName} (${result.intentDetectionConfidence})`);
  } else {
    logger.info('   🐞 No intent matched.');
  }

  const parameters = JSON.stringify(struct.decode(result.parameters as Struct));
  logger.info(`  Parameters: ${parameters}`);
  logger.debug(`  Session ID: ${sessionId}`);

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

async function runSample(filenames: string[], sessionId = uuid.v4(), audioEncoding = dialogflow.protos.google.cloud.dialogflow.v2.AudioEncoding.AUDIO_ENCODING_FLAC) {

  for (let filename of filenames) {

    // TODO Make fixed intent and other parameters more accessible and flexible
    if (FIXED_CONTEXT_NAME) {
      await detectAudioIntent(PROJECT_ID, sessionId, filename, audioEncoding, 44100, LANGUAGE_CODE, FIXED_CONTEXT_NAME);
    } else {
      await detectAudioIntent(PROJECT_ID, sessionId, filename, audioEncoding, 44100, LANGUAGE_CODE);
    }
  }
}

async function runAllSamplesInPath(filepath: string) {

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
    logger.info(`Added ${audioFileCounter} files to the test.`);


    logger.debug(`Sorting audio files ...`);
    audioFileNames.sort();

    let sessionId = uuid.v4();
    if (initialAudioFile) {
      await runSample([filepath + "/" + initialAudioFile], sessionId);
      logger.info(`Initializing context with audio file '${initialAudioFile}'.`);
    }

    for (const audioFileName of audioFileNames) {

      // If there is no initial audio file, all samples are send to inidvidual sessions 
      if (!initialAudioFile) {
        sessionId = uuid.v4();
      }

      logger.debug(`Reading audio from file '${audioFileName}'.`);
      // await runSample([filepath + "/" + audioFileName], sessionId);
      runSample([filepath + "/" + audioFileName], sessionId);
    }
  } catch (err) {
    logger.error(err);
  }
}

async function execTestsAndWait(testSamplePath: string) {

  const testRunDurationProfiler = logger.startTimer();
  await runAllSamplesInPath(process.env.DF_RECO_TESTING_PATH);
  testRunDurationProfiler.done({message: "test run"});
}

execTestsAndWait(process.env.DF_RECO_TESTING_PATH);

// runSample([TESTING_PATH + "/mein-vorname-ist-heinz.flac"]);


