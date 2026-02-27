const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

function parseSourceUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    // YouTube
    if (['youtube.com', 'youtu.be', 'm.youtube.com'].includes(host)) {
      let videoId = null;
      if (host === 'youtu.be') {
        videoId = parsed.pathname.slice(1);
      } else {
        videoId = parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).pop();
      }
      return { platform: 'youtube', videoId, url };
    }

    // TikTok
    if (['tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'].includes(host)) {
      return { platform: 'tiktok', videoId: null, url };
    }

    return null;
  } catch {
    return null;
  }
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

function parseVTT(vtt) {
  const lines = [];
  const blocks = vtt.split('\n\n');

  for (const block of blocks) {
    const parts = block.trim().split('\n');
    // Find the timestamp line
    let timestampLine = -1;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].includes('-->')) { timestampLine = i; break; }
    }
    if (timestampLine === -1) continue;

    const timeMatch = parts[timestampLine].match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (!timeMatch) continue;

    // Get text lines after timestamp
    const textLines = parts.slice(timestampLine + 1);
    let text = textLines.join(' ')
      .replace(/<[^>]+>/g, '') // Remove VTT tags like <c>, </c>, <00:00:19.039>
      .replace(/\s+/g, ' ')
      .trim();

    if (!text || text === ' ') continue;

    const startParts = timeMatch[1].split(':');
    const startSeconds = parseInt(startParts[0]) * 3600 + parseInt(startParts[1]) * 60 + parseFloat(startParts[2]);

    const endParts = timeMatch[2].split(':');
    const endSeconds = parseInt(endParts[0]) * 3600 + parseInt(endParts[1]) * 60 + parseFloat(endParts[2]);

    lines.push({
      start: startSeconds,
      duration: Math.round((endSeconds - startSeconds) * 1000) / 1000,
      text
    });
  }

  // Deduplicate consecutive lines with same text
  const deduped = [];
  for (const line of lines) {
    if (deduped.length === 0 || deduped[deduped.length - 1].text !== line.text) {
      deduped.push(line);
    }
  }

  return deduped;
}

function timeToSeconds(timeStr) {
  const parts = timeStr.split(':');
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
}

const LANG_NAMES = {
  ab: 'Abkhazian', aa: 'Afar', af: 'Afrikaans', ak: 'Akan', sq: 'Albanian',
  am: 'Amharic', ar: 'Arabic', hy: 'Armenian', as: 'Assamese', ay: 'Aymara',
  az: 'Azerbaijani', bn: 'Bangla', ba: 'Bashkir', eu: 'Basque', be: 'Belarusian',
  bho: 'Bhojpuri', bs: 'Bosnian', br: 'Breton', bg: 'Bulgarian', my: 'Burmese',
  ca: 'Catalan', ceb: 'Cebuano', zh: 'Chinese', 'zh-Hans': 'Chinese (Simplified)',
  'zh-Hant': 'Chinese (Traditional)', 'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)', 'zh-HK': 'Chinese (Hong Kong)',
  co: 'Corsican', hr: 'Croatian', cs: 'Czech', da: 'Danish', dv: 'Divehi',
  nl: 'Dutch', dz: 'Dzongkha', en: 'English', 'en-US': 'English (US)',
  'en-GB': 'English (UK)', 'en-AU': 'English (Australia)',
  'en-CA': 'English (Canada)', 'en-IN': 'English (India)',
  eo: 'Esperanto', et: 'Estonian', ee: 'Ewe', fo: 'Faroese', fj: 'Fijian',
  fil: 'Filipino', fi: 'Finnish', fr: 'French', 'fr-FR': 'French (France)',
  'fr-CA': 'French (Canada)', 'fr-BE': 'French (Belgium)',
  gl: 'Galician', ka: 'Georgian', de: 'German', 'de-DE': 'German (Germany)',
  'de-AT': 'German (Austria)', 'de-CH': 'German (Switzerland)',
  el: 'Greek', gn: 'Guarani', gu: 'Gujarati', ht: 'Haitian Creole',
  ha: 'Hausa', haw: 'Hawaiian', iw: 'Hebrew', he: 'Hebrew', hi: 'Hindi',
  hmn: 'Hmong', hu: 'Hungarian', is: 'Icelandic', ig: 'Igbo', id: 'Indonesian',
  ia: 'Interlingua', ga: 'Irish', it: 'Italian', ja: 'Japanese', jv: 'Javanese',
  kn: 'Kannada', kk: 'Kazakh', km: 'Khmer', rw: 'Kinyarwanda', ko: 'Korean',
  ku: 'Kurdish', ky: 'Kyrgyz', lo: 'Lao', la: 'Latin', lv: 'Latvian',
  ln: 'Lingala', lt: 'Lithuanian', lg: 'Luganda', lb: 'Luxembourgish',
  mk: 'Macedonian', mg: 'Malagasy', ms: 'Malay', ml: 'Malayalam', mt: 'Maltese',
  mi: 'Maori', mr: 'Marathi', mn: 'Mongolian', ne: 'Nepali', no: 'Norwegian',
  nb: 'Norwegian Bokmal', nn: 'Norwegian Nynorsk', ny: 'Nyanja', oc: 'Occitan',
  or: 'Odia', om: 'Oromo', ps: 'Pashto', fa: 'Persian', pl: 'Polish',
  pt: 'Portuguese', 'pt-BR': 'Portuguese (Brazil)', 'pt-PT': 'Portuguese (Portugal)',
  pa: 'Punjabi', qu: 'Quechua', ro: 'Romanian', rm: 'Romansh', ru: 'Russian',
  sm: 'Samoan', sg: 'Sango', sa: 'Sanskrit', gd: 'Scottish Gaelic', sr: 'Serbian',
  sn: 'Shona', sd: 'Sindhi', si: 'Sinhala', sk: 'Slovak', sl: 'Slovenian',
  so: 'Somali', st: 'Southern Sotho', es: 'Spanish', 'es-419': 'Spanish (Latin America)',
  'es-ES': 'Spanish (Spain)', 'es-MX': 'Spanish (Mexico)', 'es-US': 'Spanish (US)',
  su: 'Sundanese', sw: 'Swahili', sv: 'Swedish', tg: 'Tajik', ta: 'Tamil',
  tt: 'Tatar', te: 'Telugu', th: 'Thai', ti: 'Tigrinya', ts: 'Tsonga',
  tr: 'Turkish', tk: 'Turkmen', uk: 'Ukrainian', ur: 'Urdu', ug: 'Uyghur',
  uz: 'Uzbek', vi: 'Vietnamese', cy: 'Welsh', fy: 'Western Frisian',
  xh: 'Xhosa', yi: 'Yiddish', yo: 'Yoruba', zu: 'Zulu',
};

function getLanguageName(code) {
  if (LANG_NAMES[code]) return LANG_NAMES[code];
  // Try base code (e.g. "en" from "en-US")
  const base = code.split('-')[0];
  if (LANG_NAMES[base]) {
    const region = code.split('-').slice(1).join('-');
    return `${LANG_NAMES[base]} (${region})`;
  }
  return code;
}

// Get video info and available languages
app.get('/api/info', async (req, res) => {
  const source = parseSourceUrl(req.query.url);
  if (!source) return res.json({ error: 'Invalid or unsupported URL. Please use a YouTube or TikTok link.' });

  try {
    const json = await runYtDlp([
      '--dump-json', '--skip-download',
      source.url
    ]);
    const data = JSON.parse(json);

    const manualSubs = Object.keys(data.subtitles || {});
    const autoSubs = Object.keys(data.automatic_captions || {});

    const languages = [];
    manualSubs.forEach(code => languages.push({ code, name: getLanguageName(code), isAuto: false }));
    autoSubs.forEach(code => {
      if (!manualSubs.includes(code)) {
        languages.push({ code, name: getLanguageName(code) + ' (auto)', isAuto: true });
      }
    });

    const thumbnail = source.platform === 'youtube' && source.videoId
      ? `https://img.youtube.com/vi/${source.videoId}/hqdefault.jpg`
      : data.thumbnail || '';

    res.json({
      title: data.title || '',
      channel: data.channel || data.uploader || '',
      duration: data.duration || 0,
      thumbnail,
      languages,
      platform: source.platform
    });
  } catch (err) {
    res.json({ error: 'Failed to get video info: ' + err.message });
  }
});

// Get transcript
app.get('/api/transcript', async (req, res) => {
  const source = parseSourceUrl(req.query.url);
  if (!source) return res.json({ error: 'Invalid or unsupported URL.' });

  const lang = req.query.lang || 'en';
  const tmpId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `vt_${tmpId}_${lang}`);

  try {
    // Try manual subs first, then auto
    await runYtDlp([
      '--write-sub', '--write-auto-sub',
      '--sub-lang', lang,
      '--sub-format', 'vtt',
      '--skip-download',
      '-o', tmpFile,
      source.url
    ]);

    // Find the output file
    const vttFile = tmpFile + `.${lang}.vtt`;
    if (!fs.existsSync(vttFile)) {
      // Try to find any .vtt file with this prefix
      const dir = path.dirname(tmpFile);
      const base = path.basename(tmpFile);
      const files = fs.readdirSync(dir).filter(f => f.startsWith(base) && f.endsWith('.vtt'));
      if (files.length === 0) {
        const msg = source.platform === 'tiktok'
          ? 'No transcript available. TikTok videos typically don\'t have subtitles.'
          : 'No subtitles found for this video in the selected language.';
        return res.json({ error: msg, noSubs: true });
      }
      const vttContent = fs.readFileSync(path.join(dir, files[0]), 'utf-8');
      const transcript = parseVTT(vttContent);
      // Cleanup
      files.forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch(e) {} });
      return res.json({ transcript, language: lang });
    }

    const vttContent = fs.readFileSync(vttFile, 'utf-8');
    const transcript = parseVTT(vttContent);

    // Cleanup temp file
    try { fs.unlinkSync(vttFile); } catch(e) {}

    res.json({ transcript, language: lang });
  } catch (err) {
    // Cleanup any temp files
    try {
      const dir = path.dirname(tmpFile);
      const base = path.basename(tmpFile);
      fs.readdirSync(dir).filter(f => f.startsWith(base)).forEach(f => {
        try { fs.unlinkSync(path.join(dir, f)); } catch(e) {}
      });
    } catch(e) {}

    const msg = source.platform === 'tiktok'
      ? 'No transcript available. TikTok videos typically don\'t have subtitles.'
      : 'Failed to fetch transcript: ' + err.message;
    res.json({ error: msg, noSubs: source.platform === 'tiktok' });
  }
});

// List directories for folder picker
app.get('/api/browse', (req, res) => {
  const dir = req.query.path || os.homedir();
  try {
    const resolved = path.isAbsolute(dir) ? dir : path.join(os.homedir(), dir);
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ current: resolved, folders: entries });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Get available download formats
app.get('/api/formats', async (req, res) => {
  const source = parseSourceUrl(req.query.url);
  if (!source) return res.json({ error: 'Invalid or unsupported URL.' });

  try {
    const json = await runYtDlp([
      '--dump-json', '--skip-download',
      source.url
    ]);
    const data = JSON.parse(json);

    const formats = (data.formats || [])
      .filter(f => f.ext && f.format_note)
      .map(f => ({
        id: f.format_id,
        ext: f.ext,
        resolution: f.resolution || 'audio only',
        note: f.format_note,
        filesize: f.filesize || f.filesize_approx || null,
        vcodec: f.vcodec,
        acodec: f.acodec,
        fps: f.fps,
      }));

    res.json({ formats, title: data.title, platform: source.platform });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Download video
app.get('/api/download', async (req, res) => {
  const source = parseSourceUrl(req.query.url);
  if (!source) return res.json({ error: 'Invalid or unsupported URL.' });

  const quality = req.query.quality || 'best';
  const customPath = req.query.path || '';

  let downloadsDir;
  if (customPath) {
    // Resolve the path - support both absolute and relative paths
    downloadsDir = path.isAbsolute(customPath) ? customPath : path.join(os.homedir(), customPath);
  } else {
    downloadsDir = path.join(os.homedir(), 'Downloads');
  }
  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

  let formatArg;
  if (source.platform === 'tiktok') {
    // TikTok doesn't have the same quality tiers as YouTube
    formatArg = quality === 'audio' ? 'bestaudio' : 'best';
  } else {
    switch (quality) {
      case 'best':
        formatArg = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
        break;
      case '1080':
        formatArg = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best';
        break;
      case '720':
        formatArg = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best';
        break;
      case '480':
        formatArg = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best';
        break;
      case '360':
        formatArg = 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best';
        break;
      case 'audio':
        formatArg = 'bestaudio[ext=m4a]/bestaudio';
        break;
      default:
        formatArg = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    }
  }

  const outputTemplate = path.join(downloadsDir, '%(title)s.%(ext)s');

  try {
    const args = [
      '-f', formatArg,
      '--merge-output-format', quality === 'audio' ? 'm4a' : 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      '--print', 'after_move:filepath',
      source.url
    ];

    // Use spawn for progress tracking
    const { spawn } = require('child_process');
    const proc = spawn('yt-dlp', args);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let filepath = '';

    proc.stdout.on('data', (data) => {
      const line = data.toString().trim();
      // yt-dlp prints the filepath as the last line due to --print
      if (line && !line.startsWith('[') && !line.startsWith('Deleting') && fs.existsSync(line)) {
        filepath = line;
      }
      // Parse progress
      const progressMatch = line.match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        res.write(`data: ${JSON.stringify({ progress: parseFloat(progressMatch[1]), status: 'downloading' })}\n\n`);
      } else if (line.includes('Merging')) {
        res.write(`data: ${JSON.stringify({ progress: 100, status: 'merging' })}\n\n`);
      } else if (line.includes('Destination:')) {
        res.write(`data: ${JSON.stringify({ progress: 0, status: 'downloading', detail: 'Starting download...' })}\n\n`);
      }
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      const progressMatch = line.match(/(\d+\.?\d*)%/);
      if (progressMatch) {
        res.write(`data: ${JSON.stringify({ progress: parseFloat(progressMatch[1]), status: 'downloading' })}\n\n`);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        res.write(`data: ${JSON.stringify({ progress: 100, status: 'done', filepath: filepath || downloadsDir })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ status: 'error', message: 'Download failed' })}\n\n`);
      }
      res.end();
    });

    proc.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ status: 'error', message: err.message })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      proc.kill();
    });

  } catch (err) {
    res.json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Video Transcriber running at http://localhost:${PORT}`);
});
