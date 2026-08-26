const fs = require('fs');
const path = require('path');

const dir = 'c:/Users/Agostina Verri/Documents/Power BI Desktop/Fly Hunter/videos/fly-hunter-promo/compositions/frames';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

files.forEach(file => {
  const compId = file.replace('.html', '');
  const p = path.join(dir, file);
  let content = fs.readFileSync(p, 'utf8');

  // Fix IDs starting with digits
  content = content.replace(/id="0\d-/g, 'id="f');
  content = content.replace(/#0\d-/g, '#f');

  // Fix content-layer id
  content = content.replace(/class="clip content-layer"/, `id="content-${compId}" class="clip content-layer"`);

  // Wrap clips with root element
  if (!content.includes('data-composition-id')) {
    const parts = content.split('<script>');
    
    // Find where clips start (after </style>)
    const styleEnd = parts[0].indexOf('</style>') + 8;
    const beforeClips = parts[0].substring(0, styleEnd);
    const clips = parts[0].substring(styleEnd);
    
    const newClips = `\n  <div id="root" data-composition-id="${compId}" data-width="1080" data-height="1920">${clips}  </div>\n  `;
    
    content = beforeClips + newClips + '<script>' + parts[1];
  }

  // Fix fromTo opacity issue in 05
  content = content.replace('{ scaleX: 1, duration: 0.5, ease: "power4.in" }', '{ scaleX: 1, opacity: 1, duration: 0.5, ease: "power4.in" }');

  fs.writeFileSync(p, content);
});
console.log("Fixed files");
