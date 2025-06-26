require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { OpenAI } = require('openai');
const { Readable } = require('stream');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const FormData = require('form-data');

ffmpeg.setFfmpegPath(ffmpegPath);

const transcodeToWav = (inputBuffer) => {
  return new Promise((resolve, reject) => {
    const inputStream = Readable.from(inputBuffer);
    const output = [];

    const command = ffmpeg(inputStream)
      .inputFormat('m4a')
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(output)))
      .pipe();

    command.on('data', chunk => output.push(chunk));
  });
};

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

io.on('connection', (socket) => {
  console.log('Client connected');

  let userLang = 'en';
  let userName = '';
  const userInfo = { when: null, where: null, howOften: null, items: null };
  let infoConfirmed = false;

  const baseSystemPrompt = () => `
    You are Froogle, a cheerful and friendly AI assistant speaking in ${userLang}.
    Start by greeting the user like:
    "Hey ${userName}, it's so good to meet you! I'm Froogle, your grocery shopping assistant. Let's talk about your grocery shopping routine!"

    Your main objective is to naturally collect:
    1. When the user shops
    2. Where they shop
    3. How often they shop
    4. What they usually buy

    DO NOT ask for the user's name — it is already provided.
    Ask questions in a warm, conversational tone.
    If the user gives vague answers like "depends", use "any".
    Once all info is collected, summarize it clearly, thank the user warmly, and end the conversation.
  `;

  let conversationHistory = [
    { role: 'system', content: baseSystemPrompt() },
  ];

  let audioChunks = [];

  socket.on('setup', ({ language, name }) => {
    userLang = language || 'en';
    userName = name || 'User';
    infoConfirmed = false;

    console.log(`[SERVER] Language selected: ${userLang}, Username: ${userName}`);

    conversationHistory = [
      { role: 'system', content: baseSystemPrompt() }
    ];
  });

  socket.on('greet_user', async () => {
    try {
      conversationHistory = [
        { role: 'system', content: baseSystemPrompt() },
        { role: 'user', content: 'Hello' }
      ];

      const greeting = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: conversationHistory,
      });

      const aiText = greeting.choices[0].message.content;
      conversationHistory.push({ role: 'assistant', content: aiText });

      console.log('[SERVER] Greeted user:', aiText);
      socket.emit('ai_response', { text: aiText });

    } catch (err) {
      console.error('[SERVER] Greet error:', err?.response?.data || err.message);
      socket.emit('ai_response', { text: 'Sorry, something went wrong while greeting you.' });
    }
  });

  socket.on('audio_chunk', (base64) => {
    const buffer = Buffer.from(base64, 'base64');
    audioChunks.push(buffer);
  });

  socket.on('audio_end', async () => {
    if (!userLang || !userName) {
      console.warn('[SERVER] Missing userLang or userName');
      socket.emit('ai_response', { text: 'Waiting for setup to complete. Please try again.' });
      return;
    }

    const buffer = Buffer.concat(audioChunks);
    audioChunks = [];

    let wavBuffer;
    try {
      wavBuffer = await transcodeToWav(buffer);
    } catch (err) {
      socket.emit('ai_response', { text: 'Could not process your voice. Please try again.' });
      return;
    }

    try {
      const form = new FormData();
      form.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
      form.append('model', 'whisper-1');
      form.append('response_format', 'json');
      form.append('language', userLang);

      const transcriptionRes = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
        }
      );

      const userText = transcriptionRes.data.text;
      console.log('[SERVER] Transcription:', userText);
      socket.emit('user_transcription', { text: userText });


      const extractionPrompt = `
        You are a helpful assistant extracting grocery shopping info from the user's input.

        Only extract the fields the user actually mentioned.

        Return a **partial JSON** object with ONLY the keys the user talked about.

        Note:
        - "when" means specific days or times, e.g., "Monday morning", "weekends".
        - "howOften" means frequency, e.g., "daily", "weekly", "usually".
        - Do NOT guess or fill missing fields with "any". Omit them if not mentioned.

        Example 1:
        User: "I usually shop on Sundays."
        Return:
        { "when": "Sunday" }

        Example 2:
        User: "I buy fruits and vegetables at Walmart every Friday."
        Return:
        {
          "when": "Friday",
          "where": "Walmart",
          "items": "fruits and vegetables"
        }

        No Markdown, no explanation. Only return raw JSON.
        User said:
        """${userText}"""
      `;

      const extractionRes = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a JSON extractor assistant.' },
          { role: 'user', content: extractionPrompt },
        ],
        temperature: 0,
      });

      let extractedInfo = {};
      try {
        const raw = extractionRes.choices[0].message.content;
        const cleaned = raw.replace(/```json|```/g, '').trim();
        extractedInfo = JSON.parse(cleaned);
      } catch (e) {
        console.warn('[SERVER] Failed to parse JSON:', e.message);
        console.warn('[SERVER] Raw content:', extractionRes.choices[0].message.content);
      }

      for (const key of Object.keys(extractedInfo)) {
        if (typeof extractedInfo[key] === 'string') {
          const val = extractedInfo[key].toLowerCase().trim();
          if (['', 'null', 'undefined'].includes(val)) continue;
          userInfo[key] = extractedInfo[key];
        }
      }

      console.log('[SERVER] Updated userInfo:', JSON.stringify(userInfo, null, 2));
      conversationHistory.push({ role: 'user', content: userText });

      const allFilled = Object.values(userInfo).every(val => val);
      if (!infoConfirmed && allFilled) {
        const readable = (val, key) => {
          if (val === 'any') {
            switch (key) {
              case 'howOften': return 'whenever it fits your schedule';
              case 'where': return 'anywhere';
              case 'when': return 'any time';
              case 'items': return 'a variety of items';
              default: return 'any';
            }
          }
          return val;
        };

        const summary = `Thanks, ${userName}! Just to confirm, you shop ${readable(userInfo.howOften, 'howOften')} at ${readable(userInfo.where, 'where')}, usually on ${readable(userInfo.when, 'when')}, and you buy ${readable(userInfo.items, 'items')}. Have a great day!`;
        socket.emit('ai_response', { text: summary });
        infoConfirmed = true;
        return;
      }

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: conversationHistory,
      });

      const aiText = completion.choices[0].message.content;
      conversationHistory.push({ role: 'assistant', content: aiText });
      console.log('[SERVER] AI Response:', aiText);
      socket.emit('ai_response', { text: aiText });

    } catch (err) {
      socket.emit('ai_response', { text: 'Error understanding audio. Please try again.' });
      console.error('[SERVER] Error:', err?.response?.data || err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(3000, () => console.log('Server listening on port 3000'));
