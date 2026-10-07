const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const ioniconsFont = path.resolve(__dirname, 'assets/fonts/Ionicons.ttf');
const defaultResolve = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const normalized = String(moduleName).replace(/\\/g, '/');
  if (normalized.endsWith('Fonts/Ionicons.ttf')) {
    return { filePath: ioniconsFont, type: 'sourceFile' };
  }
  if (defaultResolve) {
    return defaultResolve(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
