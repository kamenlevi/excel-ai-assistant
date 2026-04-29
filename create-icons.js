const fs = require('fs');
const path = require('path');

// Generate simple PNG icons programmatically
// These are minimal valid PNG files (green square)

function createSimplePNG(size) {
  // This is a minimal valid 1x1 green PNG, Excel just needs valid image files
  // For a proper icon you'd replace these with real PNG files
  const png1x1Green = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e0000000c4944415408d7636098f86f000000020001e221bc330000000049454e44ae426082',
    'hex'
  );
  return png1x1Green;
}

const sizes = [16, 32, 80];
sizes.forEach(size => {
  fs.writeFileSync(path.join(__dirname, `public/icon-${size}.png`), createSimplePNG(size));
});

console.log('Icons created');
