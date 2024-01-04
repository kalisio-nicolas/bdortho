// DownloadManager.js

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class DownloadManager {
  constructor(url, workingDir, finalDirectory) {
    this.url = url;
    this.workingDir = workingDir;
    this.finalDirectory = finalDirectory;
    this.filename = url.substring(url.lastIndexOf('_D') + 1);
    this.downloadStatus = {
      progress: 0,
      speed: 0,
      isComplete: false,
      lastUpdate: Date.now(),
      downloadedLength: 0,
      totalLength: 0,
    };
  }

  async startDownload() {

    // Check if the file already exists in the final directory
    if (fs.existsSync(`${this.finalDirectory}/${this.filename}`)) {
      console.log(`File ${this.filename} already exists. Skipping download.`);
      this.downloadStatus.isComplete = true;

      return Promise.resolve();
    }

    const response = await axios({
      method: 'get',
      url: this.url,
      responseType: 'stream',
    });

    this.downloadStatus.totalLength = response.headers['content-length'];
    this.downloadStatus.lastUpdate = Date.now();
    this.downloadStatus.downloadedLength = 0;

    let chunksReceived = 0;
    let bytesReceived = 0;

    const speedCalculationInterval = 1000;
    let lastSpeedCalculationTime = Date.now();

    response.data.on('data', (chunk) => {
      this.downloadStatus.downloadedLength += chunk.length;
      this.downloadStatus.progress = (this.downloadStatus.downloadedLength / this.downloadStatus.totalLength) * 100;

      bytesReceived += chunk.length;
      chunksReceived++;

      const currentTime = Date.now();
      const elapsedTime = currentTime - lastSpeedCalculationTime;

      if (elapsedTime >= speedCalculationInterval) {
        const speed = (bytesReceived / elapsedTime) * 1000;
        this.downloadStatus.speed = (speed / 1024) * 8 / 1024;

        chunksReceived = 0;
        bytesReceived = 0;
        lastSpeedCalculationTime = currentTime;
      }
    });
    
    const writeStream = fs.createWriteStream(path.join(this.workingDir, this.filename));
    response.data.pipe(writeStream);

    return new Promise((resolve, reject) => {
      response.data.on('end', async () => {
        const closeFile = new Promise((resolve, reject) => { 
          writeStream.end()
          writeStream.close(() => { resolve() })
        })
        await closeFile
        this.downloadStatus.isComplete = true;
        // Move the file to the final directory
        fs.renameSync(`${this.workingDir}/${this.filename}`, `${this.finalDirectory}/${this.filename}`);
        response.data.destroy();
        resolve();
      });

      response.data.on('error', (err) => {
        console.error('Error during download', err);
        reject(err);
      });
    });

  }
  // Return the download size in MB (ex: 1.2/3.4 MB)
  getSizeRatio() {
    const dlSize = this.downloadStatus.downloadedLength / 1024 / 1024;
    const totalSize = this.downloadStatus.totalLength / 1024 / 1024;
    return `${dlSize.toFixed(2)}/${totalSize.toFixed(2)} MB`;
  }
  // Return the download progress in %
  getProgress() {
    return this.downloadStatus.progress;
  }
  // Return the download speed in Mbits/s
  getSpeed() {
    return this.downloadStatus.speed;
  }
  // Return true if the download is complete
  isComplete() {
    return this.downloadStatus.isComplete;
  }

  // Return the filename
  getFileName() {
    return this.filename;
  }

  // Return the estimated time until the download is complete
  getEta() {
    if (this.downloadStatus.speed === 0) {
      return 'N/A';
    }

    const remainingBytes = this.downloadStatus.totalLength - this.downloadStatus.downloadedLength;
    const remainingBits = remainingBytes * 8;
    const remainingTimeSeconds = remainingBits / (this.downloadStatus.speed * 1024 * 1024);
    const remainingTimeMinutes = remainingTimeSeconds / 60;
    const remainingTimeHours = remainingTimeMinutes / 60;

    let eta = '';
    if (remainingTimeHours >= 1) {
      eta += `${Math.floor(remainingTimeHours)}h`;
    }
    if (remainingTimeMinutes >= 1) {
      eta += `${Math.floor(remainingTimeMinutes % 60)}m`;
    }
    if (remainingTimeSeconds >= 1) {
      eta += `${Math.floor(remainingTimeSeconds % 60)}s`;
    }
    return eta;
  }

  static checkDownloadsStatus(downloadManagers) {
    console.log('----------', new Date().toLocaleString(), '------current memory usage: ', process.memoryUsage().rss / 1024 / 1024, 'MB');
    downloadManagers.forEach((downloadManager, index) => {
      if (!downloadManager.isComplete()) {
        console.log(`File ${index + 1}: ${downloadManager.getFileName()} - Progress - ${downloadManager.getProgress().toFixed(2)}% - Speed - ${downloadManager.getSpeed().toFixed(2)} Mbits/s - Total: ${downloadManager.getSizeRatio()} - ETA: ${downloadManager.getEta()}`);
      }
    });
  }
}

module.exports = DownloadManager;
