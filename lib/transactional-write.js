'use strict';

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

async function replaceVerified({
  filePath,
  originalSource,
  patchedSource,
  readFile,
  writeFile,
  verify,
  verificationError,
  rollbackConflictError
}) {
  try {
    await writeFile(filePath, patchedSource);
    if (!verify(await readFile(filePath))) {
      throw new Error(verificationError);
    }
  } catch (error) {
    try {
      const currentSource = await readFile(filePath);
      if (currentSource === patchedSource) {
        await writeFile(filePath, originalSource);
      } else if (currentSource !== originalSource) {
        throw new Error(rollbackConflictError);
      }
    } catch (rollbackError) {
      throw new Error(`${errorMessage(error)}；回滚失败：${errorMessage(rollbackError)}`);
    }
    throw error;
  }
}

async function writeVerifiedBatch({
  targets,
  readFile,
  writeFile,
  verify,
  changedBeforeWriteError,
  verificationError,
  rollbackConflictError
}) {
  const writtenTargets = [];
  try {
    for (const target of targets) {
      const currentSource = await readFile(target.filePath);
      if (currentSource !== target.originalSource) {
        throw new Error(changedBeforeWriteError);
      }
      await writeFile(target.filePath, target.patchedSource);
      writtenTargets.push(target);
      if (!verify(await readFile(target.filePath), target)) {
        throw new Error(verificationError);
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const target of writtenTargets.reverse()) {
      try {
        const currentSource = await readFile(target.filePath);
        if (currentSource !== target.patchedSource) {
          rollbackErrors.push(rollbackConflictError);
          continue;
        }
        await writeFile(target.filePath, target.originalSource);
      } catch (rollbackError) {
        rollbackErrors.push(errorMessage(rollbackError));
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${errorMessage(error)}；回滚失败：${rollbackErrors.join('；')}`);
    }
    throw error;
  }

  return writtenTargets.length;
}

module.exports = { replaceVerified, writeVerifiedBatch };
