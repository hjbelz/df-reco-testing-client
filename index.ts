// setup environment with dotenv
const dotenv = require('dotenv'); // must be a node-style require!
dotenv.config();
const TESTING_PATH = process.env.DF_RECO_TESTING_PATH;

// Some useful info
console.log(`Connecting with credentials from ${process.env.GOOGLE_APPLICATION_CREDENTIALS}.`);
// console.log(`Testing audio files in path ${process.env.DF_RECO_TESTING_PATH}.`);

// Google Dialogflow dependencies
import dialogflow = require('@google-cloud/dialogflow');
import uuid = require('uuid');

import fs = require('fs');
import util = require('util');
import path = require('path');

import { Struct, struct } from 'pb-util';


// Project parameters
// TODO Move to environment variables or a JSON config file
const PROJECT_ID = 'df-reco-testing';
const LANGUAGE_CODE = 'de-DE';


// TODO See https://www.smashingmagazine.com/2021/01/dialogflow-agent-react-application/#handling-voice-inputs
// TODO See https://github.com/googleapis/gax-nodejs/blob/main/client-libraries.md#creating-the-client-instance
// TODO See https://github.com/savelee/kube-django-ng/blob/master/chatserver/src/dialogflow.ts


async function detectAudioIntent(
  projectId: string,
  sessionId: string,
  filename: string,
  encoding: dialogflow.protos.google.cloud.dialogflow.v2.AudioEncoding,
  sampleRateHertz: number,
  languageCode: string
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
    queryInput: {
      audioConfig: {
        audioEncoding: encoding,
        sampleRateHertz: sampleRateHertz,
        languageCode: languageCode,
      },
    },
    inputAudio: inputAudio,
  };

  // Recognizes the speech in the audio and detects its intent.
  const [response] = await sessionClient.detectIntent(request);

  console.log(`--- Response for audio file ${path.basename(filename)} -----------------------`);
  const result = response.queryResult;
  // Instantiates a context client
  const contextClient = new dialogflow.ContextsClient();

  console.log(`   🎤 Query: ${result.queryText}`);
  console.log(`   🔈 Response: ${result.fulfillmentText}`);
  if (result.intent) {
    let intentEmoji = result.intent.isFallback? "🧨" : "💡";
    console.log(`   ${intentEmoji} Intent: ${result.intent.displayName} (${result.intentDetectionConfidence})`);
  } else {
    console.log('   🐞 No intent matched.');
  }

  const parameters = JSON.stringify(struct.decode(result.parameters as Struct));
  console.log(`  Parameters: ${parameters}\n`);
  
  /* TODO Format output context and make optional.
  if (result.outputContexts && result.outputContexts.length) {
    console.log('  Output contexts:');
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
      console.log(`    ${contextId}`);
      console.log(`      lifespan: ${context.lifespanCount}`);
      console.log(`      parameters: ${contextParameters}`);
    });
  } 
  */
}

async function runSample(filenames: string[], sessionId = uuid.v4(), audioEncoding = dialogflow.protos.google.cloud.dialogflow.v2.AudioEncoding.AUDIO_ENCODING_FLAC) {

  for (let filename of filenames) {

    // Send request (and log result)
    // console.log(`-----------------\nDetecting intent from audio file ${filename} `);
    await detectAudioIntent(PROJECT_ID, sessionId, filename, audioEncoding, 44100, LANGUAGE_CODE);
  }
}

async function runAllSamplesInPath(filepath: string) {

  console.log(`Reading audio files from folder ${filepath}`);

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
          console.log("Using " + dirEntry.name + " as initial utterance.");

        } else {
          audioFileNames.push(dirEntry.name);
          audioFileCounter++;
        }

      } else {
        console.info("❌ Ignored dir entry " + dirEntry.name);
      }
    }
    console.log(`Added ${audioFileCounter} files to the test.`);

    const sessionId = uuid.v4();
    if (initialAudioFile) {
      await runSample([filepath + "/" + initialAudioFile], sessionId);
      console.log(`Initializing context with audio file '${initialAudioFile}'.`);
    }

    for (const audioFileName of audioFileNames) {
      console.log(`Reading audio from file '${audioFileName}'.`);
      runSample([filepath + "/" + audioFileName], sessionId);
    }
  } catch (err) {
    console.error(err);
  }
}

runAllSamplesInPath(process.env.DF_RECO_TESTING_PATH);

// runSample([TESTING_PATH + "/mein-vorname-ist-heinz.flac"]);


