const express = require('express');
const chromium = require('chrome-aws-lambda');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const os = require('os');

const app = express();
const port = process.env.PORT || 3000;

// Function to fetch m3u8 URLs from a given webpage
async function getM3U8Urls(pageUrl) {
  let browser;
  try {
    console.log(`Launching Puppeteer to fetch m3u8 URLs for: ${pageUrl}`);
    browser = await chromium.puppeteer.launch({
      executablePath: await chromium.executablePath,
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    const m3u8Urls = [];

    page.on('request', request => {
      if (request.url().includes('.m3u8')) {
        console.log(`Intercepted .m3u8 URL: ${request.url()}`);
        m3u8Urls.push(request.url());
      }
    });

    await page.goto(pageUrl, { waitUntil: 'networkidle0' });
    console.log(`Page loaded successfully for URL: ${pageUrl}`);
    await browser.close();

    if (m3u8Urls.length === 0) {
      throw new Error('Failed to find any .m3u8 URL');
    }

    return m3u8Urls;
  } catch (error) {
    console.error('Error in getM3U8Urls:', error);
    if (browser) await browser.close();
    throw error;
  }
}

// Function to find the valid video m3u8 URL
async function findVideoM3U8(m3u8Urls) {
  try {
    console.log(`Finding valid video m3u8 URL from: ${m3u8Urls}`);
    for (const url of m3u8Urls) {
      console.log(`Checking .m3u8 URL: ${url}`);
      const response = await axios.get(url);
      const content = response.data;

      if (content.includes('#EXT-X-STREAM-INF')) {
        console.log(`Selected .m3u8 URL: ${url}`);
        return url;
      }
    }

    throw new Error('No valid video .m3u8 URL found');
  } catch (error) {
    console.error('Error in findVideoM3U8:', error);
    throw error;
  }
}

// Function to download the video using ffmpeg
async function downloadVideo(m3u8Url) {
  try {
    console.log(`Downloading video from m3u8 URL: ${m3u8Url}`);
    const tempDir = os.tmpdir();
    const outputFilePath = path.join(tempDir, 'output.mp4');

    return new Promise((resolve, reject) => {
      console.log(`Starting ffmpeg with .m3u8 URL: ${m3u8Url}`);
      ffmpeg(m3u8Url)
        .outputOptions('-c copy')
        .on('start', commandLine => {
          console.log(`ffmpeg process started with command: ${commandLine}`);
        })
        .on('progress', progress => {
          console.log(`ffmpeg progress: ${JSON.stringify(progress)}`);
        })
        .on('end', () => {
          console.log('ffmpeg process finished successfully');
          resolve(outputFilePath);
        })
        .on('error', err => {
          console.error(`ffmpeg error: ${err.message}`);
          reject(err);
        })
        .save(outputFilePath);
    });
  } catch (error) {
    console.error('Error in downloadVideo:', error);
    throw error;
  }
}

// API route handler for downloading the video
app.get('/api/downloadVideo', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    console.error('Missing URL in request');
    res.status(400).json({ error: 'Missing URL' });
    return;
  }

  try {
    console.log('Fetching m3u8 URLs...');
    const m3u8Urls = await getM3U8Urls(url);
    console.log(`Fetched m3u8 URLs: ${m3u8Urls}`);

    console.log('Finding valid video m3u8 URL...');
    const m3u8Url = await findVideoM3U8(m3u8Urls);
    console.log(`Valid video m3u8 URL found: ${m3u8Url}`);

    console.log('Downloading video...');
    const outputFilePath = await downloadVideo(m3u8Url);
    console.log(`Video downloaded successfully: ${outputFilePath}`);

    fs.readFile(outputFilePath, (err, data) => {
      if (err) {
        console.error('Error reading the file:', err);
        res.status(500).json({ error: 'Failed to read the video file' });
        return;
      }

      res.setHeader('Content-Disposition', 'attachment; filename=output.mp4');
      res.setHeader('Content-Type', 'video/mp4');
      res.end(data, 'binary', () => {
        console.log('File sent successfully');
        fs.unlinkSync(outputFilePath);
      });
    });
  } catch (error) {
    console.error('Error in API handler:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
