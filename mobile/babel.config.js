// Expo's default babel preset + the Reanimated plugin.
//
// Reanimated requires its babel plugin to compile the `worklet`
// directive on functions destined to run on the UI thread. Without
// it, worklets silently run on the JS thread on native (kills perf
// for drag-and-drop gestures) and become `undefined` on web. The
// plugin MUST be the last entry in `plugins` per Reanimated docs;
// other plugins in the chain leave it nothing to transform if they
// strip directives first.
//
// Added in PR-D0 alongside `react-native-gesture-handler` +
// `react-native-reanimated` deps so subsequent drag-and-drop work
// (PR-D2+) has the worklet transform in place.
//
// See https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin',
    ],
  };
};
