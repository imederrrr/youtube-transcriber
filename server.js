const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

function parseSourceUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
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

    // Instagram
    if (['instagram.com', 'i.instagram.com'].includes(host)) {
      return { platform: 'instagram', videoId: null, url };
    }

    // Facebook
    if (['facebook.com', 'fb.watch', 'm.facebook.com', 'fb.com'].includes(host)) {
      return { platform: 'facebook', videoId: null, url };
    }

    // X / Twitter
    if (['twitter.com', 'x.com', 'mobile.twitter.com', 'mobile.x.com'].includes(host)) {
      return { platform: 'twitter', videoId: null, url };
    }

    // Reddit
    if (['reddit.com', 'old.reddit.com', 'v.redd.it'].includes(host) || host.endsWith('.reddit.com')) {
      return { platform: 'reddit', videoId: null, url };
    }

    // Vimeo
    if (['vimeo.com', 'player.vimeo.com'].includes(host)) {
      return { platform: 'vimeo', videoId: null, url };
    }

    // Dailymotion
    if (['dailymotion.com', 'dai.ly'].includes(host)) {
      return { platform: 'dailymotion', videoId: null, url };
    }

    // Twitch
    if (['twitch.tv', 'clips.twitch.tv', 'm.twitch.tv'].includes(host)) {
      return { platform: 'twitch', videoId: null, url };
    }

    // Douyin
    if (['douyin.com', 'iesdouyin.com'].includes(host) || host.endsWith('.douyin.com')) {
      return { platform: 'douyin', videoId: null, url };
    }

    // Xiaohongshu
    if (['xiaohongshu.com', 'xhslink.com'].includes(host) || host.endsWith('.xiaohongshu.com')) {
      return { platform: 'xiaohongshu', videoId: null, url };
    }

    // Generic — let yt-dlp try any other HTTP(S) URL
    return { platform: 'other', videoId: null, url };
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
  if (!source) return res.json({ error: 'Invalid URL. Please paste a valid video link (e.g. https://...).' });

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
  if (!source) return res.json({ error: 'Invalid URL. Please paste a valid video link (e.g. https://...).' });

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
        const msg = source.platform === 'youtube'
          ? 'No subtitles found for this video in the selected language.'
          : 'No transcript available. Most platforms don\'t provide subtitles.';
        return res.json({ error: msg, noSubs: source.platform !== 'youtube' });
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

    const msg = source.platform === 'youtube'
      ? 'Failed to fetch transcript: ' + err.message
      : 'No transcript available. Most platforms don\'t provide subtitles.';
    res.json({ error: msg, noSubs: source.platform !== 'youtube' });
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
  if (!source) return res.json({ error: 'Invalid URL. Please paste a valid video link (e.g. https://...).' });

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

// Download video — progress stream
app.get('/api/download', async (req, res) => {
  const source = parseSourceUrl(req.query.url);
  if (!source) return res.json({ error: 'Invalid URL. Please paste a valid video link (e.g. https://...).' });

  const quality = req.query.quality || 'best';

  // Create a unique temp directory for this download
  const downloadId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const downloadsDir = path.join(os.tmpdir(), 'vt-downloads', downloadId);
  fs.mkdirSync(downloadsDir, { recursive: true });

  let formatArg;
  if (source.platform === 'youtube') {
    // YouTube: prefer mp4/m4a containers for broad compatibility
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
  } else {
    // All other platforms: generic format, let yt-dlp pick best available
    switch (quality) {
      case 'best':
        formatArg = 'bestvideo+bestaudio/best';
        break;
      case '1080':
        formatArg = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
        break;
      case '720':
        formatArg = 'bestvideo[height<=720]+bestaudio/best[height<=720]/best';
        break;
      case '480':
        formatArg = 'bestvideo[height<=480]+bestaudio/best[height<=480]/best';
        break;
      case '360':
        formatArg = 'bestvideo[height<=360]+bestaudio/best[height<=360]/best';
        break;
      case 'audio':
        formatArg = 'bestaudio';
        break;
      default:
        formatArg = 'bestvideo+bestaudio/best';
    }
  }

  const outputTemplate = path.join(downloadsDir, '%(title)s.%(ext)s');

  try {
    const args = [
      '-f', formatArg,
      '--merge-output-format', quality === 'audio' ? 'm4a' : 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      source.url
    ];

    const { spawn } = require('child_process');
    const proc = spawn('yt-dlp', args);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    proc.stdout.on('data', (data) => {
      const line = data.toString().trim();
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
        // Find the downloaded file in the unique temp directory
        try {
          const files = fs.readdirSync(downloadsDir).filter(f => !f.endsWith('.part'));
          if (files.length > 0) {
            res.write(`data: ${JSON.stringify({ progress: 100, status: 'done', downloadId, filename: files[0] })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ progress: 100, status: 'done' })}\n\n`);
          }
        } catch(e) {
          res.write(`data: ${JSON.stringify({ progress: 100, status: 'done' })}\n\n`);
        }
      } else {
        res.write(`data: ${JSON.stringify({ status: 'error', message: 'Download failed' })}\n\n`);
        // Clean up on failure
        try { fs.rmSync(downloadsDir, { recursive: true }); } catch(e) {}
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

// Serve downloaded file to user's browser
app.get('/api/file', (req, res) => {
  const { id, name } = req.query;
  if (!id || !name) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  // Prevent path traversal: only allow simple directory/file names
  if (/[/\\]/.test(id) || /[/\\]/.test(name)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  const dirPath = path.join(os.tmpdir(), 'vt-downloads', id);
  const filepath = path.join(dirPath, name);
  // Verify resolved path stays inside the expected directory
  if (!filepath.startsWith(dirPath)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.download(filepath, name, (err) => {
    // Clean up the entire temp directory after sending
    try { fs.rmSync(dirPath, { recursive: true }); } catch(e) {}
  });
});

app.listen(PORT, () => {
  console.log(`Video Transcriber running at http://localhost:${PORT}`);
});
