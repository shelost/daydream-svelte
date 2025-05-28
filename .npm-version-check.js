// This script checks if the Node.js version meets the requirements
const requiredVersion = '18.0.0';
const currentVersion = process.version.replace('v', '');

function compareVersions(v1, v2) {
  const v1parts = v1.split('.');
  const v2parts = v2.split('.');

  for (let i = 0; i < v1parts.length; ++i) {
    if (v2parts.length === i) {
      return 1;
    }

    if (v1parts[i] === v2parts[i]) {
      continue;
    }

    return parseInt(v1parts[i], 10) > parseInt(v2parts[i], 10) ? 1 : -1;
  }

  if (v1parts.length !== v2parts.length) {
    return -1;
  }

  return 0;
}

if (compareVersions(currentVersion, requiredVersion) < 0) {
  console.error('\x1b[31m%s\x1b[0m', `Error: This project requires Node.js v${requiredVersion} or higher.`);
  console.error('\x1b[31m%s\x1b[0m', `You are currently using Node.js ${currentVersion}.`);
  console.error('\x1b[36m%s\x1b[0m', 'Please use nvm to switch to a compatible version:');
  console.error('\x1b[33m%s\x1b[0m', '  nvm use');
  console.error('\x1b[36m%s\x1b[0m', 'Or install a compatible version:');
  console.error('\x1b[33m%s\x1b[0m', '  nvm install 18');
  process.exit(1);
}

// If we get here, the version is compatible
console.log('\x1b[32m%s\x1b[0m', `Using Node.js ${currentVersion} ✓`);