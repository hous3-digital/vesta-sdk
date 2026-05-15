const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Default fetch stub — returns a valid 64-char hex challenge.
// Individual tests can override global.fetch as needed.
global.fetch = () =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ challenge: 'ab'.repeat(32) }),
  });
