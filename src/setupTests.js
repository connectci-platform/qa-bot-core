// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom lacks these. react-chatbotify needs structuredClone and the crypto
// functions to render, and the Q&A flow decodes streamed responses with
// TextDecoder.
const nodeCrypto = require('crypto');
const { TextDecoder, TextEncoder } = require('util');

if (!global.TextDecoder) global.TextDecoder = TextDecoder;
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.structuredClone) {
  const v8 = require('v8');
  global.structuredClone = (value) => v8.deserialize(v8.serialize(value));
}
if (!global.crypto) global.crypto = {};
if (!global.crypto.randomUUID) {
  global.crypto.randomUUID = () => nodeCrypto.randomUUID();
}
if (!global.crypto.getRandomValues) {
  global.crypto.getRandomValues = (array) => nodeCrypto.getRandomValues(array);
}
// react-chatbotify builds an audio graph even with audio disabled. Every
// node method is a no-op.
if (!global.AudioContext) {
  const node = () =>
    new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'then') return undefined;
        if (!(prop in target)) target[prop] = typeof prop === 'string' && /^(gain|frequency|detune)$/.test(prop) ? node() : () => node();
        return target[prop];
      },
    });
  global.AudioContext = class {
    constructor() {
      return node();
    }
  };
}
