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
import { Struct, struct } from 'pb-util';


// Project parameters
// TODO Move to environment variables or a JSON config file
const PROJECT_ID = 'df-reco-testing';
const LANGUAGE_CODE = 'de-DE';


// TODO See https://www.smashingmagazine.com/2021/01/dialogflow-agent-react-application/#handling-voice-inputs
// TODO See https://github.com/googleapis/gax-nodejs/blob/main/client-libraries.md#creating-the-client-instance


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

  console.log('Detected intent:');
  const result = response.queryResult;
  // Instantiates a context client
  const contextClient = new dialogflow.ContextsClient();

  console.log(`  Query: ${result.queryText}`);
  console.log(`  Response: ${result.fulfillmentText}`);
  if (result.intent) {
    console.log(`  Intent: ${result.intent.displayName}`);
  } else {
    console.log('  No intent matched.');
  }

  const parameters = JSON.stringify(struct.decode(result.parameters as Struct));
  console.log(`  Parameters: ${parameters}`);
  if (result.outputContexts && result.outputContexts.length) {
    console.log('  Output contexts:');
    result.outputContexts.forEach((context: { name?: string; parameters?: any; lifespanCount?: number; }) => {
      const contextId = contextClient.matchContextFromProjectAgentSessionContextName(
        context.name
      );
      const contextParameters = JSON.stringify(
        struct.decode(context.parameters)
      );
      console.log(`    ${contextId}`);
      console.log(`      lifespan: ${context.lifespanCount}`);
      console.log(`      parameters: ${contextParameters}`);
    });
  }
}

async function runSample(filenames: string[], sessionId = uuid.v4(), audioEncoding = dialogflow.protos.google.cloud.dialogflow.v2.AudioEncoding.AUDIO_ENCODING_FLAC) {

  for (let filename of filenames) {

    // Send request and log result
    console.log(`Attempting to detect intent from audio file ${filename} `);
    await detectAudioIntent(PROJECT_ID, sessionId, filename, audioEncoding, 44100, LANGUAGE_CODE);
  }
}

function runAllSamplesInPath(filepath: string) {

  console.log(`Reading audio files from folder ${filepath}`);

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(filepath, { withFileTypes: true });
    for (const dirEntry of dirEntries)
      if (dirEntry.isFile) {
        console.log("Reading from audio from file " + dirEntry.name);
        runSample([filepath + "/" + dirEntry.name]);
      }
  } catch (err) {
    console.error(err);
  }
}




runAllSamplesInPath(process.env.DF_RECO_TESTING_PATH);

// runSample([TESTING_PATH + "/mein-vorname-ist-heinz.flac"]);


