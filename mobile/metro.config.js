/**
 * Metro has to be told about the workspace: the app lives in mobile/ but imports
 * @shridhar/shared from the repo root, and its dependencies are hoisted to the root
 * node_modules. Without watchFolders it will not see changes in shared; without
 * nodeModulesPaths it will not resolve the hoisted packages.
 */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Two copies of React would break hooks, so resolution never walks up past those two.
config.resolver.disableHierarchicalLookup = true;

/*
 * Keep the server root at the app, not at the workspace.
 *
 * watchFolders includes the repo root so changes in shared/ are seen, and Expo then takes the
 * workspace root as the root that every path is named relative to. In a release build that
 * breaks twice over: Metro is asked for `./index.js` and looks for it at the repo root, and
 * expo-updates joins the same answer onto the app directory and looks for mobile/mobile/index.js.
 *
 * The switch that settles it for all three is the EXPO_NO_METRO_WORKSPACE_ROOT=1 environment
 * variable, which build-apk.sh sets -- it reaches resolveAppEntry and expo-updates, which a
 * config file cannot. This line says the same thing to Metro itself, so the two agree however
 * Metro is started. EAS sets the equivalent for you, which is why cloud builds never hit any of
 * this and the first three local ones did.
 */
config.server = { ...(config.server ?? {}), unstable_serverRoot: projectRoot };

module.exports = config;
