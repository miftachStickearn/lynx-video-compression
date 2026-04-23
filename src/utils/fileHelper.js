const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

const ensureDirectories = async (...dirs) => {
  for (const dir of dirs) {
    await fs.ensureDir(dir);
  }
};

const deleteFile = async (filePath) => {
  try {
    if (await fs.pathExists(filePath)) await fs.remove(filePath);
  } catch (err) {
    logger.warn(`Failed to delete ${filePath}: ${err.message}`);
  }
};

const cleanOldFiles = async (dir, maxAgeHours) => {
  let removed = 0;
  try {
    if (!(await fs.pathExists(dir))) return 0;
    const files = await fs.readdir(dir);
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < cutoff) {
        await fs.remove(fullPath);
        removed++;
      }
    }
  } catch (err) {
    logger.warn(`Cleanup error in ${dir}: ${err.message}`);
  }
  return removed;
};

module.exports = { ensureDirectories, deleteFile, cleanOldFiles };
